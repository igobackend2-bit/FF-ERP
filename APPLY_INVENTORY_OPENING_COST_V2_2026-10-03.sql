-- ============================================================================
-- APPLY_INVENTORY_OPENING_COST_V2_2026-10-03.sql
-- Same as APPLY_INVENTORY_OPENING_COST_2026-10-04.sql - gives stock already on the shelf an opening
-- buying cost from the latest purchase-order rate - EXCEPT it skips Coriander.
--
-- Why Coriander is skipped: it is counted in BUNCHES, but the purchase orders price it per KG
-- (Rs 15-17 per kg in bulk, Rs 70-80 for small lots). Putting Rs 15 on a bunch would be wrong
-- (a bunch sells for Rs 8-12). Set its cost per bunch by hand on the Inventory page (pencil):
--     cost per bunch = weight of one bunch in kg  x  Rs 15-17 per kg.
--
-- Rules (unchanged):
--   * only stock lines with quantity > 0 and NO cost yet are touched, so the 51 costs already set stay;
--   * lines with no PO rate stay empty ("cost not set") - never guessed;
--   * every filled line gets an inventory_log row ('adjustment', qty 0) as a paper trail;
--   * a wrong rate can be corrected on the Inventory page by admin / FF ops manager / accounts.
-- Run ADD_COST_MATCHING_V2 first. Safe to run twice.
-- ============================================================================

begin;

with upd as (
  update public.inventory i
     set avg_cost = r.rate, cost_source = 'opening_from_po', cost_updated_at = now()
    from public.products p
    cross join lateral public.inv_po_rate(p.id, now()) r
   where p.id = i.product_id and i.quantity > 0 and i.avg_cost is null
     and lower(btrim(p.name)) not like 'coriander%'          -- counted in bunches, PO is per kg
  returning i.id, i.hub_id, i.product_id, i.avg_cost
)
insert into public.inventory_log (inventory_id, hub_id, product_id, event_type, qty_delta, ref_type, notes, unit_cost)
select id, hub_id, product_id, 'adjustment', 0, 'adjustment',
       'Opening cost set from latest PO rate (Rs ' || round(avg_cost, 2) || ' per unit)', avg_cost
from upd;

commit;

-- VERIFY (read-only). Expect still_without_cost = 7 (6 with no PO line + Coriander).
select count(*) filter (where quantity > 0)                          as stock_lines,
       count(*) filter (where quantity > 0 and avg_cost is not null) as with_cost,
       count(*) filter (where quantity > 0 and avg_cost is null)     as still_without_cost,
       round(sum(quantity * avg_cost) filter (where quantity > 0))   as stock_value_at_cost
from public.inventory;

-- Lines still without a cost (set these on the Inventory page):
select h.name as hub, p.name as product, p.unit, round(i.quantity::numeric, 1) as qty
from public.inventory i join public.products p on p.id = i.product_id join public.hubs h on h.id = i.hub_id
where i.quantity > 0 and i.avg_cost is null
order by i.quantity desc;
