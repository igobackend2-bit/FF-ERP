-- ADD_ACCOUNTS_OPERATIONS_WIRING.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Closes the gaps between operations and the books found in the 2026-09-30 wiring audit.
-- Needs: ADD_ACCOUNTS_LEDGER_CORE / AUTO_POSTING / PAYMENTS_RECEIVED / CASH_COLLECTIONS /
--        CREDIT_DEBIT_NOTES / PAYROLL / VENDOR_CREDITS / FIXED_ASSET_REGISTER already applied.
--
-- Run CHECK_ACCOUNTS_OPERATIONS_GAPS.sql FIRST and read sections C and D. This file back-posts
-- history, so payment_requests (§3) posts EVERY paid request since the books start.
--
--   §1 Fixed asset ACQUISITION and DISPOSAL (depreciation was posting with no asset cost behind it,
--      leaving Net Fixed Assets negative on the Balance Sheet).
--        bank / cash : Dr asset account  Cr Bank / Cash          (purchase_date on/after books start)
--        opening     : Dr asset account  Cr Opening Balance Equity, dated on the books start
--        disposal    : Dr Bank (proceeds) + Dr Accumulated Depreciation, Cr asset cost,
--                      gain → Other Income, loss → Office & Admin Expenses
--   §2 Daily cash closing DEPOSIT: Dr Kotak Bank / Cr Cash in Hand for cash_deposited (the field
--      cash was debited to Cash in Hand by verified collections but never moved to the bank).
--   §3 payment_requests marked paid (general company payments made from the bank):
--        Dr Office & Admin Expenses (5370)  Cr Kotak Bank      dated paid_at (IST), ref = UTR
--      Reclassify to a specific expense with a journal where needed.
--   §4 acct_backpost_all() now covers every posted source.
-- NOT wired here (live columns unverified — see the CHECK file): rent (rental_monthly_records),
-- petty cash, daily_expense_sheet, IGO vendor_payments.
-- ADDITIVE + IDEMPOTENT. Run on qwiumswrbddwmlraktvy → Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── §1 Fixed assets ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS funding text NOT NULL DEFAULT 'bank';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fixed_assets_funding_check') THEN
    ALTER TABLE public.fixed_assets ADD CONSTRAINT fixed_assets_funding_check
      CHECK (funding IN ('bank','cash','opening'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.acct_sync_fixed_asset(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.fixed_assets; v_start date; v_cost numeric; v_acq jsonb; v_disp jsonb; v_type text;
  v_open jsonb; v_pay jsonb; v_credit text; v_acc numeric; v_proceeds numeric; v_gain numeric;
  a text; b text; c text; v_lines jsonb;
BEGIN
  SELECT * INTO r FROM public.fixed_assets WHERE id = p_id;
  SELECT books_start_date INTO v_start FROM public.acct_settings WHERE id = 1;
  v_cost := round(coalesce(r.purchase_cost, 0), 2);

  IF r.id IS NOT NULL AND v_cost > 0 THEN
    IF r.funding = 'opening' OR r.purchase_date < v_start THEN
      v_open := jsonb_build_object(
        'posting_date', v_start, 'hub_id', r.hub_id, 'is_opening', true,
        'narration', 'Opening balance · asset ' || r.asset_name || coalesce(' (' || r.asset_code || ')', ''),
        'lines', jsonb_build_array(
          jsonb_build_object('account_id', r.account_id, 'debit', v_cost),
          jsonb_build_object('system_key', 'opening_equity', 'credit', v_cost)));
    ELSE
      v_credit := CASE WHEN r.funding = 'cash' THEN 'cash' ELSE 'bank_default' END;
      v_pay := jsonb_build_object(
        'posting_date', r.purchase_date, 'hub_id', r.hub_id,
        'narration', 'Asset purchase · ' || r.asset_name || coalesce(' (' || r.asset_code || ')', ''),
        'lines', jsonb_build_array(
          jsonb_build_object('account_id', r.account_id, 'debit', v_cost),
          jsonb_build_object('system_key', v_credit, 'credit', v_cost)));
    END IF;
  END IF;

  -- disposal: remove cost and accumulated depreciation, book proceeds and the gain / loss
  IF r.id IS NOT NULL AND r.status = 'disposed' AND v_cost > 0 THEN
    v_acc := round(coalesce(r.accumulated_depreciation, 0), 2);
    v_proceeds := round(coalesce(r.disposal_value, 0), 2);
    v_gain := round(v_proceeds + v_acc - v_cost, 2);
    v_lines := jsonb_build_array(
      jsonb_build_object('system_key', 'bank_default', 'debit', v_proceeds),
      jsonb_build_object('system_key', 'accumulated_depreciation', 'debit', v_acc),
      jsonb_build_object('account_id', r.account_id, 'credit', v_cost),
      jsonb_build_object('system_key', 'other_income', 'credit', greatest(v_gain, 0)),
      jsonb_build_object('account_code', '5370', 'debit', greatest(-v_gain, 0)));
    v_disp := jsonb_build_object(
      'posting_date', greatest(coalesce(r.disposal_date, current_date), v_start), 'hub_id', r.hub_id,
      'narration', 'Asset disposal · ' || r.asset_name || coalesce(' (' || r.asset_code || ')', ''),
      'lines', v_lines);
  END IF;

  a := public.acct__sync('fixed_assets', p_id, 'opening', v_open, 'Asset changed or removed');
  b := public.acct__sync('fixed_assets', p_id, 'payment', v_pay,  'Asset changed or removed');
  c := public.acct__sync('fixed_assets', p_id, 'journal', v_disp, 'Asset changed or removed');
  RETURN a || '/' || b || '/' || c;
END $$;

CREATE OR REPLACE FUNCTION public.acct_trg_fixed_assets() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.acct_sync_fixed_asset(CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- depreciation accumulation changes on every run; only re-sync on fields the vouchers depend on
DROP TRIGGER IF EXISTS acct_autopost_trg ON public.fixed_assets;
CREATE TRIGGER acct_autopost_trg AFTER INSERT OR DELETE OR UPDATE OF
    purchase_cost, purchase_date, account_id, hub_id, funding, status, disposal_date, disposal_value
  ON public.fixed_assets FOR EACH ROW EXECUTE FUNCTION public.acct_trg_fixed_assets();

-- ── §2 Daily cash closing: cash deposited to the bank ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acct_sync_cash_closing(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.daily_cash_closings; v_start date; v_amt numeric; v_payload jsonb;
BEGIN
  SELECT * INTO r FROM public.daily_cash_closings WHERE id = p_id;
  SELECT books_start_date INTO v_start FROM public.acct_settings WHERE id = 1;
  v_amt := round(coalesce(r.cash_deposited, 0), 2);
  IF r.id IS NOT NULL AND v_amt > 0 AND r.closing_date >= v_start THEN
    v_payload := jsonb_build_object(
      'posting_date', r.closing_date, 'hub_id', r.hub_id,
      'narration', 'Cash deposited to bank · daily closing ' || r.closing_date,
      'lines', jsonb_build_array(
        jsonb_build_object('system_key', 'bank_default', 'debit', v_amt),
        jsonb_build_object('system_key', 'cash', 'credit', v_amt)));
  END IF;
  RETURN public.acct__sync('daily_cash_closings', p_id, 'contra', v_payload, 'Cash closing changed or removed');
END $$;

CREATE OR REPLACE FUNCTION public.acct_trg_cash_closings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.acct_sync_cash_closing(CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS acct_autopost_trg ON public.daily_cash_closings;
CREATE TRIGGER acct_autopost_trg AFTER INSERT OR UPDATE OR DELETE ON public.daily_cash_closings
  FOR EACH ROW EXECUTE FUNCTION public.acct_trg_cash_closings();

-- ── §3 payment_requests paid from the bank ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acct_sync_payment_request(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests; v_start date; v_amt numeric; v_date date; v_payload jsonb;
BEGIN
  SELECT * INTO r FROM public.payment_requests WHERE id = p_id;
  SELECT books_start_date INTO v_start FROM public.acct_settings WHERE id = 1;
  v_amt := round(coalesce(r.amount, 0), 2);
  v_date := public.acct__ist(coalesce(r.paid_at, r.updated_at, r.created_at));
  IF r.id IS NOT NULL AND r.status = 'paid' AND v_amt > 0 AND v_date >= v_start THEN
    v_payload := jsonb_build_object(
      'posting_date', v_date, 'party_type', 'other', 'party_name', r.vendor_name, 'reference_no', r.utr_number,
      'narration', 'Payment · ' || coalesce(r.vendor_name, '') || ' · ' || left(coalesce(r.purpose, ''), 120)
                   || coalesce(' · UTR ' || r.utr_number, ''),
      'lines', jsonb_build_array(
        jsonb_build_object('account_code', '5370', 'debit', v_amt),
        jsonb_build_object('system_key', 'bank_default', 'credit', v_amt)));
  END IF;
  RETURN public.acct__sync('payment_requests', p_id, 'payment', v_payload, 'Payment request changed or removed');
END $$;

CREATE OR REPLACE FUNCTION public.acct_trg_payment_requests() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- the table changes at every approval stage; only paid rows (or rows leaving paid) matter
  IF TG_OP = 'INSERT' AND NEW.status <> 'paid' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'paid' AND OLD.status <> 'paid' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' AND OLD.status <> 'paid' THEN RETURN NULL; END IF;
  PERFORM public.acct_sync_payment_request(CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS acct_autopost_trg ON public.payment_requests;
CREATE TRIGGER acct_autopost_trg AFTER INSERT OR UPDATE OR DELETE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.acct_trg_payment_requests();

REVOKE EXECUTE ON FUNCTION public.acct_sync_fixed_asset(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acct_trg_fixed_assets()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acct_sync_cash_closing(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acct_trg_cash_closings()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acct_sync_payment_request(uuid)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acct_trg_payment_requests()        FROM PUBLIC, anon, authenticated;

-- ── §4 Back-post everything (definitive list — supersedes the earlier definitions) ─────────────
CREATE OR REPLACE FUNCTION public.acct_backpost_all() RETURNS TABLE (source text, result text, documents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.acct_can_write() OR public.acct_can_approve()) THEN
    RAISE EXCEPTION 'Only Accounts, Admin or CEO can back-post';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _acct_bp (source text, result text) ON COMMIT DROP;
  TRUNCATE _acct_bp;
  INSERT INTO _acct_bp SELECT 'sales_orders', public.acct_sync_sales_order(id)
    FROM public.sales_orders ORDER BY coalesce(delivery_date, order_date), created_at;
  INSERT INTO _acct_bp SELECT 'ff_vendor_payments', public.acct_sync_ff_vendor_payment(id)
    FROM public.ff_vendor_payments ORDER BY created_at;
  INSERT INTO _acct_bp SELECT 'ff_transport_payments', public.acct_sync_ff_transport_payment(id)
    FROM public.ff_transport_payments ORDER BY created_at;
  INSERT INTO _acct_bp SELECT 'wastage_entries', public.acct_sync_wastage(id)
    FROM public.wastage_entries ORDER BY entry_date, created_at;
  INSERT INTO _acct_bp SELECT 'credit_notes', public.acct_sync_credit_note(id)
    FROM public.credit_notes ORDER BY coalesce(issued_date, created_at::date), created_at;
  INSERT INTO _acct_bp SELECT 'debit_notes', public.acct_sync_debit_note(id)
    FROM public.debit_notes ORDER BY coalesce(issued_date, created_at::date), created_at;
  INSERT INTO _acct_bp SELECT 'payments_received', public.acct_sync_payment_received(id)
    FROM public.payments_received ORDER BY coalesce(received_date, created_at::date), created_at;
  INSERT INTO _acct_bp SELECT 'cash_collections', public.acct_sync_cash_collection(id)
    FROM public.cash_collections ORDER BY coalesce(collection_date, created_at::date), created_at;
  INSERT INTO _acct_bp SELECT 'salary_batches', public.acct_sync_salary_batch(id)
    FROM public.salary_batches ORDER BY created_at;
  INSERT INTO _acct_bp SELECT 'vendor_credits', public.acct_sync_vendor_credit(id)
    FROM public.vendor_credits ORDER BY created_at;
  INSERT INTO _acct_bp SELECT 'fixed_assets', public.acct_sync_fixed_asset(id)
    FROM public.fixed_assets ORDER BY purchase_date, created_at;
  INSERT INTO _acct_bp SELECT 'daily_cash_closings', public.acct_sync_cash_closing(id)
    FROM public.daily_cash_closings ORDER BY closing_date, created_at;
  INSERT INTO _acct_bp SELECT 'payment_requests', public.acct_sync_payment_request(id)
    FROM public.payment_requests WHERE status = 'paid' ORDER BY coalesce(paid_at, created_at);
  RETURN QUERY SELECT b.source, b.result, count(*) FROM _acct_bp b GROUP BY 1, 2 ORDER BY 1, 2;
END $$;
REVOKE EXECUTE ON FUNCTION public.acct_backpost_all() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.acct_backpost_all() TO authenticated;

SELECT * FROM public.acct_backpost_all();

-- verify (paste back): ledger must still balance, no new posting errors
SELECT 'ledger debit − credit (must be 0)' AS check_name, coalesce(sum(debit) - sum(credit), 0)::text AS value FROM public.acct_gl
UNION ALL SELECT 'open posting errors', count(*)::text FROM public.acct_posting_errors WHERE NOT resolved
UNION ALL SELECT 'auto-post triggers', count(*)::text FROM pg_trigger WHERE tgname = 'acct_autopost_trg';
