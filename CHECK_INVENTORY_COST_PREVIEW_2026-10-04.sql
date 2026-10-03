-- ============================================================================
-- CHECK_INVENTORY_COST_PREVIEW_2026-10-04.sql   (READ-ONLY - changes nothing)
-- Run AFTER ADD_INVENTORY_COST_2026-10-04.sql. Shows, for every stock line on the shelf, the
-- buying rate the system would take from the purchase orders, so you can eyeball it before
-- running APPLY_INVENTORY_OPENING_COST_2026-10-04.sql.
--
-- What to look for: rate_vs_selling is normally 0.5 - 1.1 (we buy below we sell). Anything far
-- outside that, or a rate that looks wrong for the product, can be corrected afterwards on the
-- Inventory page (admin) - or simply skip it: lines with no rate stay "cost not set".
-- ============================================================================

-- A. Line by line (priced lines first, biggest value first; unpriced lines at the bottom)
select h.name as hub, p.name as product, p.unit,
       round(i.quantity::numeric, 1)                    as qty,
       r.rate                                           as buying_rate,
       r.source, r.lines_used,
       p.price                                          as selling_price,
       round(r.rate / nullif(p.price, 0), 2)            as rate_vs_selling,
       round(i.quantity * r.rate)                       as value_at_cost,
       case when r.rate is null then
         case when lower(btrim(p.unit)) <> 'kg' then 'unit is not kg (PO lines are per kg)'
              else 'no matching PO line in last 14 days' end
       end                                              as why_no_rate
from public.inventory i
join public.products p on p.id = i.product_id
join public.hubs h on h.id = i.hub_id
left join lateral public.inv_po_rate(p.id, now()) r on true
where i.quantity > 0
order by (r.rate is null), i.quantity * coalesce(r.rate, 0) desc;

-- B. Totals
select count(*)                                                    as stock_lines,
       count(r.rate)                                               as lines_with_rate,
       count(*) filter (where r.rate is null)                      as lines_without_rate,
       round(sum(i.quantity * r.rate))                             as stock_value_at_cost,
       round(sum(i.quantity * p.price) filter (where r.rate is not null)) as same_lines_at_selling_price,
       round(sum(i.quantity) filter (where r.rate is null))        as qty_without_rate
from public.inventory i
join public.products p on p.id = i.product_id
left join lateral public.inv_po_rate(p.id, now()) r on true
where i.quantity > 0;
