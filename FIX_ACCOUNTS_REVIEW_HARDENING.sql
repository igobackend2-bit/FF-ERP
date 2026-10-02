-- FIX_ACCOUNTS_REVIEW_HARDENING.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Needs: ADD_ACCOUNTS_LEDGER_CORE.sql + ADD_ACCOUNTS_AUTO_POSTING.sql already applied.
-- Fixes from the 2026-09-30 accounting-module review:
--   1. Manual vouchers must name a party on every debtor / creditor line (was UI-only), so
--      ageing always agrees with the ledger.
--   3. acct_create_voucher only accepts the types the Journal page offers and ignores
--      client-supplied is_opening / reversal_of / is_auto (no bypass of the books-start rule).
--   5. Approving a pending voucher needs a second person (no self-approval).
--   6. Year-end closing: acct_close_fiscal_year() moves the year's income & expenses to
--      Retained Earnings, then closes the year and opens the next one.
--      acct_trial_balance gets p_exclude_closing so the P&L of a closed year still shows its
--      real income / expenses (the closing voucher is marked source_table = 'acct_fiscal_years').
-- Additive + idempotent (CREATE OR REPLACE; one DROP/CREATE of acct_trial_balance for its new arg).
-- Run on: qwiumswrbddwmlraktvy → Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── 1. Party required on debtor / creditor lines of manual vouchers ────────────────────────────
CREATE OR REPLACE FUNCTION public.acct__post(p_id uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.acct_vouchers; s public.acct_settings; fy public.acct_fiscal_years;
  v_dr numeric; v_cr numeric; v_lines int; v_bad text;
BEGIN
  SELECT * INTO v FROM public.acct_vouchers WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Voucher not found'; END IF;
  IF v.status NOT IN ('draft','pending_approval') THEN
    RAISE EXCEPTION 'Voucher % is already %', v.voucher_no, v.status;
  END IF;
  SELECT * INTO s FROM public.acct_settings WHERE id = 1;

  IF v.posting_date < s.books_start_date AND NOT v.is_opening THEN
    RAISE EXCEPTION 'Posting date % is before the books start date %', v.posting_date, s.books_start_date;
  END IF;
  IF s.lock_date IS NOT NULL AND v.posting_date <= s.lock_date THEN
    RAISE EXCEPTION 'Books are locked up to %; post this on a later date', s.lock_date;
  END IF;
  fy := public.acct__fiscal_year_for(v.posting_date);
  IF fy.id IS NULL THEN RAISE EXCEPTION 'No fiscal year covers %', v.posting_date; END IF;
  IF fy.is_closed AND v.voucher_type <> 'period_closing' THEN
    RAISE EXCEPTION '% is closed', fy.name;
  END IF;

  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO v_dr, v_cr, v_lines
  FROM public.acct_voucher_lines WHERE voucher_id = p_id;
  IF v_lines < 2 THEN RAISE EXCEPTION 'A voucher needs at least two lines'; END IF;
  IF v_dr <> v_cr THEN RAISE EXCEPTION 'Voucher does not balance: debit % ≠ credit %', v_dr, v_cr; END IF;
  IF v_dr = 0 THEN RAISE EXCEPTION 'Voucher total is zero'; END IF;

  SELECT string_agg(a.code || ' ' || a.name, ', ') INTO v_bad
  FROM public.acct_voucher_lines l JOIN public.acct_accounts a ON a.id = l.account_id
  WHERE l.voucher_id = p_id AND (a.is_group OR NOT a.is_active);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Cannot post to group or inactive account(s): %', v_bad; END IF;

  -- manual entries only (auto-postings and reversals mirror an existing document)
  IF NOT v.is_auto AND v.voucher_type <> 'reversal' THEN
    SELECT string_agg(DISTINCT a.code || ' ' || a.name, ', ') INTO v_bad
    FROM public.acct_voucher_lines l JOIN public.acct_accounts a ON a.id = l.account_id
    WHERE l.voucher_id = p_id AND a.account_type IN ('receivable','payable') AND l.party_id IS NULL;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Debtor / creditor lines need a customer, vendor or transporter: %', v_bad;
    END IF;
  END IF;

  UPDATE public.acct_vouchers SET status = 'posted', total_debit = v_dr, total_credit = v_cr,
    fiscal_year_id = fy.id, posted_by = p_user, posted_at = now()
  WHERE id = p_id;
END $$;

-- ── 3. Public create: whitelist types, ignore privileged keys ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.acct_create_voucher(p jsonb, p_action text DEFAULT 'submit') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_type text := p->>'voucher_type';
BEGIN
  IF NOT public.acct_can_write() THEN RAISE EXCEPTION 'Only Accounts or Admin can create vouchers'; END IF;
  IF v_type IS NULL OR v_type NOT IN ('journal','receipt','payment','contra','credit_note','debit_note','opening') THEN
    RAISE EXCEPTION 'Voucher type % cannot be created manually', coalesce(v_type, '(none)');
  END IF;
  v_id := public.acct__insert_voucher(
    (p - 'source_table' - 'source_id' - 'is_auto' - 'is_opening' - 'reversal_of')
      || jsonb_build_object('is_opening', v_type = 'opening'),
    auth.uid());
  IF p_action = 'draft' THEN
    RETURN v_id;
  ELSIF public.acct_can_approve() AND p_action IN ('submit','post') THEN
    UPDATE public.acct_vouchers SET approved_by = auth.uid(), approved_at = now(), submitted_at = now() WHERE id = v_id;
    PERFORM public.acct__post(v_id, auth.uid());
  ELSE
    UPDATE public.acct_vouchers SET status = 'pending_approval', submitted_at = now() WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

-- ── 5. No self-approval of a pending voucher ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acct_approve_voucher(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.acct_can_approve() THEN RAISE EXCEPTION 'Only Admin or CEO can approve vouchers'; END IF;
  IF EXISTS (SELECT 1 FROM public.acct_vouchers WHERE id = p_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'You created this voucher; another Admin or CEO must approve it';
  END IF;
  UPDATE public.acct_vouchers SET approved_by = auth.uid(), approved_at = now()
  WHERE id = p_id AND status = 'pending_approval';
  IF NOT FOUND THEN RAISE EXCEPTION 'Voucher is not pending approval'; END IF;
  PERFORM public.acct__post(p_id, auth.uid());
END $$;

-- ── 6a. Trial balance: optionally leave year-close vouchers out of the period columns ──────────
DROP FUNCTION IF EXISTS public.acct_trial_balance(date, date, uuid);
CREATE OR REPLACE FUNCTION public.acct_trial_balance(p_from date, p_to date, p_hub uuid DEFAULT NULL,
                                                     p_exclude_closing boolean DEFAULT false)
RETURNS TABLE (account_id uuid, code text, name text, parent_id uuid, root_type text, account_type text,
               opening numeric, period_debit numeric, period_credit numeric, closing numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT a.id, a.code, a.name, a.parent_id, a.root_type, a.account_type,
         coalesce(sum(g.debit - g.credit) FILTER (WHERE g.posting_date < p_from), 0),
         coalesce(sum(g.debit)  FILTER (WHERE g.posting_date BETWEEN p_from AND p_to
                                          AND NOT (p_exclude_closing AND g.source_table = 'acct_fiscal_years')), 0),
         coalesce(sum(g.credit) FILTER (WHERE g.posting_date BETWEEN p_from AND p_to
                                          AND NOT (p_exclude_closing AND g.source_table = 'acct_fiscal_years')), 0),
         coalesce(sum(g.debit - g.credit) FILTER (WHERE g.posting_date <= p_to), 0)
  FROM public.acct_accounts a
  LEFT JOIN public.acct_gl g ON g.account_id = a.id AND (p_hub IS NULL OR g.hub_id = p_hub)
  WHERE NOT a.is_group
  GROUP BY a.id
  ORDER BY a.code;
$$;
GRANT EXECUTE ON FUNCTION public.acct_trial_balance(date, date, uuid, boolean) TO authenticated;

-- ── 6b. Year-end close ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acct_close_fiscal_year(p_fy uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fy public.acct_fiscal_years; s public.acct_settings; v_lines jsonb; v_net numeric; v_id uuid;
  v_re uuid; v_y int;
BEGIN
  IF NOT public.acct_can_approve() THEN RAISE EXCEPTION 'Only Admin or CEO can close a financial year'; END IF;
  SELECT * INTO fy FROM public.acct_fiscal_years WHERE id = p_fy FOR UPDATE;
  IF fy.id IS NULL THEN RAISE EXCEPTION 'Financial year not found'; END IF;
  IF fy.is_closed THEN RAISE EXCEPTION '% is already closed', fy.name; END IF;
  IF EXISTS (SELECT 1 FROM public.acct_fiscal_years WHERE start_date < fy.start_date AND NOT is_closed) THEN
    RAISE EXCEPTION 'Close the earlier financial year first';
  END IF;
  SELECT * INTO s FROM public.acct_settings WHERE id = 1;
  IF s.lock_date IS NOT NULL AND s.lock_date >= fy.end_date THEN
    RAISE EXCEPTION 'Books are locked up to %; unlock before closing the year', s.lock_date;
  END IF;
  IF EXISTS (SELECT 1 FROM public.acct_vouchers
             WHERE posting_date BETWEEN fy.start_date AND fy.end_date AND status IN ('draft','pending_approval')) THEN
    RAISE EXCEPTION 'Post or cancel all draft / pending vouchers dated in % first', fy.name;
  END IF;
  SELECT id INTO v_re FROM public.acct_accounts WHERE system_key = 'retained_earnings';

  -- one line per (account, hub) that zeroes its year balance
  WITH bal AS (
    SELECT g.account_id, g.hub_id, sum(g.debit - g.credit) AS net
    FROM public.acct_gl g
    WHERE g.root_type IN ('income','expense') AND g.posting_date BETWEEN fy.start_date AND fy.end_date
      AND g.source_table IS DISTINCT FROM 'acct_fiscal_years'
    GROUP BY g.account_id, g.hub_id HAVING abs(sum(g.debit - g.credit)) >= 0.005
  )
  SELECT coalesce(sum(net), 0),
         jsonb_agg(jsonb_build_object('account_id', account_id, 'hub_id', hub_id,
                   'debit', CASE WHEN net < 0 THEN -net ELSE 0 END,
                   'credit', CASE WHEN net > 0 THEN net ELSE 0 END,
                   'remarks', 'Year-end close'))
  INTO v_net, v_lines FROM bal;

  IF v_lines IS NOT NULL THEN
    -- Retained Earnings takes the opposite of the summed closing lines: profit (net < 0) is a credit
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_re,
                 'debit', CASE WHEN v_net > 0 THEN v_net ELSE 0 END,
                 'credit', CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
                 'remarks', 'Profit / (loss) for ' || fy.name));
    v_id := public.acct__insert_voucher(jsonb_build_object(
      'voucher_type', 'period_closing', 'posting_date', fy.end_date, 'is_auto', true,
      'source_table', 'acct_fiscal_years', 'source_id', fy.id,
      'narration', 'Year-end closing ' || fy.name || ' — income & expenses to Retained Earnings',
      'lines', v_lines), auth.uid());
    UPDATE public.acct_vouchers SET approved_by = auth.uid(), approved_at = now() WHERE id = v_id;
    PERFORM public.acct__post(v_id, auth.uid());
  END IF;

  UPDATE public.acct_fiscal_years SET is_closed = true, closed_by = auth.uid(), closed_at = now() WHERE id = fy.id;

  IF NOT EXISTS (SELECT 1 FROM public.acct_fiscal_years WHERE start_date = fy.end_date + 1) THEN
    v_y := extract(year FROM fy.end_date + 1)::int;
    INSERT INTO public.acct_fiscal_years (name, short_code, start_date, end_date)
    VALUES ('FY ' || v_y || '-' || lpad(((v_y + 1) % 100)::text, 2, '0'),
            lpad((v_y % 100)::text, 2, '0') || '-' || lpad(((v_y + 1) % 100)::text, 2, '0'),
            fy.end_date + 1, (fy.end_date + 1) + interval '1 year' - interval '1 day');
  END IF;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.acct_close_fiscal_year(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.acct_close_fiscal_year(uuid) TO authenticated;

-- ── Verify (paste back) ────────────────────────────────────────────────────────────────────────
SELECT 'functions ok' AS what,
       (SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('acct_close_fiscal_year','acct_trial_balance','acct_create_voucher','acct_approve_voucher','acct__post')) AS value
UNION ALL SELECT 'trial_balance overloads (must be 1)',
       (SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'acct_trial_balance');
