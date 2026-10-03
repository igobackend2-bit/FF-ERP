-- READ-ONLY preview: what turning on "sales take stock out" would do right now.
-- Run this AFTER ADD_INVENTORY_OUTBOUND_2026-10-03.sql and BEFORE ENABLE_INVENTORY_OUTBOUND_2026-10-03.sql.
-- It changes nothing.
--
-- Result, one table:
--   A. would deduct  per hub and product: kg that would come out for orders that ALREADY have a
--                    "delivered" signal (collection entered, invoice paid, or order delivered), what is on
--                    hand now, and what would be left. "capped at 0" means the sale is larger than the stock
--                    on record (stock never goes below zero).
--   B. summary       counts: orders in scope, how many already have a signal, how many are still waiting for
--                    one, and the sale lines that CANNOT be deducted (no product match / no stock record).
--
-- Reading it: only orders delivering on or after the start date count (see inventory_outbound_settings).
-- Orders without a signal yet are not deducted; they will be, one by one, as collections are entered,
-- invoices marked paid, or orders marked delivered.

WITH st AS (SELECT start_date FROM public.inventory_outbound_settings LIMIT 1),
ord AS (
  SELECT so.id, so.hub_id,
         (so.status = 'delivered'
          OR EXISTS (SELECT 1 FROM public.cash_collections c WHERE c.order_id = so.id)
          OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.order_id = so.id AND i.status = 'paid')) AS has_signal
  FROM public.sales_orders so, st
  WHERE so.status <> 'cancelled' AND coalesce(so.delivery_date, so.order_date) >= st.start_date
),
lines AS (
  SELECT o.id AS order_id, o.hub_id, soi.product_name,
         coalesce(soi.qty_kg, soi.quantity, 0)::numeric AS qty,
         coalesce(soi.product_id,
                  (SELECT min(p.id::text)::uuid FROM public.products p
                   WHERE lower(btrim(p.name)) = lower(btrim(soi.product_name)) HAVING count(*) = 1)) AS product_id
  FROM ord o JOIN public.sales_order_items soi ON soi.order_id = o.id
  WHERE o.has_signal AND o.hub_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.inventory_order_deductions d WHERE d.order_id = o.id AND d.skipped_reason IS NULL)
)
SELECT 'A. would deduct' AS section, coalesce(h.display_name, h.name) AS hub, p.name AS product,
       sum(l.qty) AS would_deduct_kg, max(i.quantity)::numeric AS on_hand_kg,
       greatest(0, max(i.quantity)::numeric - sum(l.qty)) AS left_after_kg,
       CASE WHEN sum(l.qty) > max(i.quantity)::numeric THEN 'more than on hand - capped at 0' ELSE '' END AS note
FROM lines l
JOIN public.inventory i ON i.hub_id = l.hub_id AND i.product_id = l.product_id
JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.hubs h ON h.id = l.hub_id
WHERE l.product_id IS NOT NULL AND l.qty > 0
GROUP BY h.display_name, h.name, p.name
UNION ALL SELECT 'B. summary', '', 'orders delivering from the start date', count(*)::numeric, NULL, NULL, '' FROM ord
UNION ALL SELECT 'B. summary', '', 'orders that already have a delivered / paid / collection signal', (count(*) FILTER (WHERE has_signal))::numeric, NULL, NULL, '' FROM ord
UNION ALL SELECT 'B. summary', '', 'orders still waiting for a signal', (count(*) FILTER (WHERE NOT has_signal))::numeric, NULL, NULL, '' FROM ord
UNION ALL SELECT 'B. summary', '', 'signalled orders with no hub (skipped)', (count(*) FILTER (WHERE hub_id IS NULL AND has_signal))::numeric, NULL, NULL, '' FROM ord
UNION ALL SELECT 'B. summary', '', 'lines not matched to any product', count(*)::numeric, NULL, NULL, 'not deducted' FROM lines WHERE product_id IS NULL AND qty > 0
UNION ALL SELECT 'B. summary', '', 'lines whose product has no stock record at that hub', count(*)::numeric, NULL, NULL, 'not deducted'
  FROM lines l WHERE l.product_id IS NOT NULL AND l.qty > 0
   AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.hub_id = l.hub_id AND i.product_id = l.product_id)
ORDER BY 1, 3;
