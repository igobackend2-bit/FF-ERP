-- Invoice date should follow the date selected on the order, not the day the row was created.
--
-- What the user saw (2026-10-02): orders typed in on the evening of 01 Oct (18:00-19:23 IST)
-- with delivery date 02 Oct showed "01 Oct 2026" on Sales Invoices.
--
-- Root cause: auto_create_invoice() inserts the draft invoice with only
-- (order_id, customer_id, amount, status), so invoices.invoice_date fell back to its column
-- default CURRENT_DATE = the day the order row was created. Orders from the app/website never
-- send an order_date either (it also defaults to CURRENT_DATE), and the date the user picks is
-- stored in sales_orders.delivery_date.
--
-- What this script does:
--   1. auto_create_invoice(): invoice_date = COALESCE(delivery_date, order_date, CURRENT_DATE)
--      for every NEW order from now on.
--   2. Corrects draft invoices that were stamped BEFORE their order's selected date
--      (invoice_date < delivery_date). Drafts only; exactly 12 rows at time of writing:
--      INV-20261001-1125, 1127, 1130, 1131, 1132, 1133, 1134, 1135, 1136, 1137, 1138, 1139
--      (all 2026-10-01 -> 2026-10-02).
--
-- What it deliberately does NOT do:
--   * sales_orders.order_date is untouched. run_eod_po_engine(p_date) filters on
--     so.order_date = p_date, so moving it would drop these orders out of the nightly PO run.
--   * Invoice numbers (INV-YYYYMMDD-nnnn) and order numbers are identifiers and keep the
--     creation-day prefix, e.g. INV-20261001-1139 will show Date = 02 Oct 2026.
--   * Issued invoices (unpaid / paid) are not touched; 646 of them carry a different date than
--     their order, from older bulk-import and Sync runs. Draft invoices dated BEFORE their order
--     (10 rows from 26 Aug) are also left alone.
--
-- To undo step 2: update invoices set invoice_date = '2026-10-01'
--   where invoice_number in ('INV-20261001-1125','INV-20261001-1127','INV-20261001-1130',
--   'INV-20261001-1131','INV-20261001-1132','INV-20261001-1133','INV-20261001-1134',
--   'INV-20261001-1135','INV-20261001-1136','INV-20261001-1137','INV-20261001-1138',
--   'INV-20261001-1139');
--
-- STATUS: NOT YET APPLIED. Run in the Supabase SQL Editor (project qwiumswrbddwmlraktvy).
-- Idempotent: running it twice changes nothing the second time.

-- 1. New orders ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_create_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.invoices (order_id, customer_id, amount, status, invoice_date)
  VALUES (NEW.id, NEW.customer_id, NEW.total_amount, 'draft',
          COALESCE(NEW.delivery_date, NEW.order_date, CURRENT_DATE))
  ON CONFLICT (order_id) WHERE order_id IS NOT NULL AND status <> 'cancelled' DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2. The 12 draft invoices already stamped with the wrong (earlier) day -------------------------
UPDATE invoices i
SET invoice_date = so.delivery_date
FROM sales_orders so
WHERE so.id = i.order_id
  AND i.status = 'draft'
  AND so.delivery_date IS NOT NULL
  AND i.invoice_date < so.delivery_date;

-- Verify: first query must return 0 rows; second shows the corrected dates.
SELECT i.invoice_number, i.invoice_date, so.delivery_date
FROM invoices i JOIN sales_orders so ON so.id = i.order_id
WHERE i.status = 'draft' AND so.delivery_date IS NOT NULL AND i.invoice_date < so.delivery_date;

SELECT i.invoice_number, i.invoice_date, so.order_number, so.delivery_date
FROM invoices i JOIN sales_orders so ON so.id = i.order_id
WHERE i.invoice_number BETWEEN 'INV-20261001-1125' AND 'INV-20261001-1140'
ORDER BY i.invoice_number;
