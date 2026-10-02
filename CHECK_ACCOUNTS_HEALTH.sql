-- CHECK_ACCOUNTS_HEALTH.sql — read-only. Run in Supabase SQL Editor (qwiumswrbddwmlraktvy), paste result back.
-- Every "issues" value should be 0.
SELECT '1. ledger debit − credit (must be 0)' AS check_name,
       coalesce(sum(debit) - sum(credit), 0)::text AS value FROM public.acct_gl
UNION ALL SELECT '2. open posting errors',
       count(*)::text FROM public.acct_posting_errors WHERE NOT resolved
UNION ALL SELECT '3. debtor/creditor ledger lines with no party (leaks out of ageing)',
       count(*)::text FROM public.acct_gl WHERE account_type IN ('receivable','payable') AND party_id IS NULL
UNION ALL SELECT '4. debtors: ledger balance − ageing total',
       (coalesce((SELECT sum(debit - credit) FROM public.acct_gl WHERE party_type = 'customer' AND account_type IN ('receivable','payable')), 0)
        - coalesce((SELECT sum(outstanding) FROM public.acct_party_ageing('receivable', current_date)), 0))::text
UNION ALL SELECT '5. sales vouchers with no customer',
       count(*)::text FROM public.acct_vouchers WHERE voucher_type = 'sales_invoice' AND status = 'posted' AND party_id IS NULL
UNION ALL SELECT '6. vouchers stuck in draft / pending approval',
       count(*)::text FROM public.acct_vouchers WHERE status IN ('draft','pending_approval')
UNION ALL SELECT '7. posted vouchers whose totals differ from lines',
       count(*)::text FROM public.acct_vouchers v WHERE v.status = 'posted'
         AND (v.total_debit <> (SELECT coalesce(sum(debit),0) FROM public.acct_voucher_lines WHERE voucher_id = v.id)
           OR v.total_debit <> v.total_credit)
UNION ALL SELECT '8. stock in hand balance (0 = never adjusted)',
       coalesce(sum(debit - credit), 0)::text FROM public.acct_gl WHERE account_type = 'stock';
