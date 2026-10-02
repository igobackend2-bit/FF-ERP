-- CHECK_ACCOUNTS_OPERATIONS_GAPS.sql — READ-ONLY. Run in Supabase SQL Editor (qwiumswrbddwmlraktvy)
-- BEFORE ADD_ACCOUNTS_OPERATIONS_WIRING.sql, and paste all four result sets back.

-- A. Which auto-post triggers exist (expect 13 rows after the wiring file: 10 today + 3 new)
SELECT 'A. trigger' AS section, tgrelid::regclass::text AS item, NULL::text AS detail
FROM pg_trigger WHERE tgname = 'acct_autopost_trg' ORDER BY 2;

-- B. Live columns of the sources I could NOT verify from the repo (rent, petty cash, expenses, IGO vendor payments)
SELECT 'B. columns' AS section, table_name AS item,
       string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS detail
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('rental_monthly_records','petty_cash_ledger','petty_cash_refill_requests',
                     'daily_expense_sheet','vendor_payments','payment_requests')
GROUP BY table_name ORDER BY table_name;

-- C. Money that has moved in operations but is NOT in the ledger
SELECT 'C. unposted' AS section, x.item, x.detail FROM (
  SELECT 'payment_requests paid' AS item,
         count(*) || ' rows · ₹' || coalesce(sum(amount),0) || ' · statuses seen: ' ||
         (SELECT string_agg(DISTINCT status, ',') FROM public.payment_requests) AS detail
    FROM public.payment_requests WHERE status = 'paid'
  UNION ALL SELECT 'rental payments executed',
         count(*) || ' rows · ₹' || coalesce(sum(net_payable_amount),0)
    FROM public.rental_monthly_records WHERE status = 'PAYMENT_EXECUTED'
  UNION ALL SELECT 'vendor_payments (IGO) rows',
         count(*)::text FROM public.vendor_payments
  UNION ALL SELECT 'daily_expense_sheet rows', count(*) || ' · ₹' || coalesce(sum(amount),0) FROM public.daily_expense_sheet
  UNION ALL SELECT 'petty_cash_ledger rows', count(*)::text FROM public.petty_cash_ledger
  UNION ALL SELECT 'fixed assets cost registered vs posted to asset accounts',
         'register ₹' || coalesce((SELECT sum(purchase_cost) FROM public.fixed_assets WHERE status = 'active'),0)
         || ' · ledger cost accounts ₹' ||
         coalesce((SELECT sum(debit - credit) FROM public.acct_gl WHERE account_type = 'fixed_asset'
                     AND account_code <> '1240'),0)
         || ' · accumulated depreciation ₹' ||
         coalesce((SELECT sum(credit - debit) FROM public.acct_gl WHERE account_code = '1240'),0)
  UNION ALL SELECT 'cash deposited per daily closings vs moved to bank in ledger',
         'closings ₹' || coalesce((SELECT sum(cash_deposited) FROM public.daily_cash_closings),0)
         || ' · contra vouchers ₹' || coalesce((SELECT sum(total_debit) FROM public.acct_vouchers
                                                 WHERE voucher_type = 'contra' AND status = 'posted'),0)
  UNION ALL SELECT 'Cash in Hand ledger balance (should not run into lakhs)',
         '₹' || coalesce((SELECT sum(debit - credit) FROM public.acct_gl WHERE account_type = 'cash'),0)
  UNION ALL SELECT 'Kotak bank ledger balance',
         '₹' || coalesce((SELECT sum(debit - credit) FROM public.acct_gl WHERE account_type = 'bank'),0)
) x;

-- D. Possible double-counted customer receipts (same customer, same amount, within 3 days, in BOTH
--    payments_received (verified) and cash_collections (verified)) — each pair would credit the debtor twice
SELECT 'D. duplicate receipt?' AS section,
       p.customer_name AS item,
       '₹' || p.amount || ' · payments_received ' || p.received_date || ' vs cash_collections ' || c.collection_date AS detail
FROM public.payments_received p
JOIN public.cash_collections c
  ON c.customer_id = p.customer_id AND c.customer_id IS NOT NULL
 AND round(c.collected_amount,2) = round(p.amount,2)
 AND abs(coalesce(c.collection_date, c.created_at::date) - coalesce(p.received_date, p.created_at::date)) <= 3
WHERE p.status = 'verified' AND c.verified_at IS NOT NULL
ORDER BY p.received_date DESC LIMIT 50;
