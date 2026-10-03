-- SWITCH ON "sales take stock out". Run only after ADD_INVENTORY_OUTBOUND_2026-10-03.sql and after you have
-- reviewed CHECK_INVENTORY_OUTBOUND_PREVIEW_2026-10-03.sql.
--
-- What it does:
--   1. Turns the switch on (inventory_outbound_settings.enabled = true).
--   2. Applies, once, the orders that ALREADY have a delivered / paid / collection signal and deliver on or
--      after the start date (source 'backfill'). From now on the three triggers handle each new signal.
--      Each order is deducted at most once, so running this twice is harmless.
--
-- TO SWITCH OFF AGAIN (stops all further deductions; the ledger rows already written stay):
--   update public.inventory_outbound_settings set enabled = false, updated_at = now();
-- Stock already taken out is NOT put back by switching off.
--
-- STATUS: NOT YET RUN.

UPDATE public.inventory_outbound_settings SET enabled = true, updated_at = now();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT so.id
    FROM public.sales_orders so, public.inventory_outbound_settings st
    WHERE so.status <> 'cancelled'
      AND coalesce(so.delivery_date, so.order_date) >= st.start_date
      AND (so.status = 'delivered'
           OR EXISTS (SELECT 1 FROM public.cash_collections c WHERE c.order_id = so.id)
           OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = so.id AND i.status = 'paid'))
    ORDER BY coalesce(so.delivery_date, so.order_date), so.created_at
  LOOP
    PERFORM public.inv_deduct_for_order(r.id, 'backfill');
  END LOOP;
END $$;

-- Verify: switch is on, and the orders deducted so far with what was taken out.
SELECT st.enabled, st.start_date,
       (SELECT count(*) FROM public.inventory_order_deductions WHERE skipped_reason IS NULL)                AS orders_deducted,
       (SELECT round(sum(applied_kg), 3) FROM public.inventory_order_deductions WHERE skipped_reason IS NULL) AS kg_taken_out,
       (SELECT count(*) FROM public.inventory_log WHERE event_type = 'sale')                                AS sale_ledger_rows
FROM public.inventory_outbound_settings st;
