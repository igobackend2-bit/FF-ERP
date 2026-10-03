-- ============================================================================
-- APPLY_INVENTORY_OPENING_COST_2026-10-04.sql
-- Gives the stock that is ALREADY on the shelf an opening buying cost, taken from the latest
-- purchase-order rate (same rule as every new QC receipt). Run after reviewing
-- CHECK_INVENTORY_COST_PREVIEW_2026-10-04.sql.
--
--   * only stock lines with quantity > 0 and NO cost yet are touched (re-running is harmless);
--   * lines with no PO rate are left empty ("cost not set") - never guessed;
--   * each line gets an inventory_log row ('adjustment', qty 0) so the cost has a paper trail;
--   * a wrong rate can be corrected on the Inventory page by admin / FF ops manager / accounts.
-- ============================================================================

begin;

with upd as (
  update public.inventory i
     set avg_cost = r.rate, cost_source = 'opening_from_po', cost_updated_at = now()
    from public.products p
    cross join lateral public.inv_po_rate(p.id, now()) r
   where p.id = i.product_id and i.quantity > 0 and i.avg_cost is null
  returning i.id, i.hub_id, i.product_id, i.avg_cost
)
insert into public.inventory_log (inventory_id, hub_id, product_id, event_type, qty_delta, ref_type, notes, unit_cost)
select id, hub_id, product_id, 'adjustment', 0, 'adjustment',
       'Opening cost set from latest PO rate (Rs ' || round(avg_cost, 2) || ' per unit)', avg_cost
from upd;

commit;

-- VERIFY (read-only)
select count(*) filter (where quantity > 0)                          as stock_lines,
       count(*) filter (where quantity > 0 and avg_cost is not null) as with_cost,
       count(*) filter (where quantity > 0 and avg_cost is null)     as still_without_cost,
       round(sum(quantity * avg_cost) filter (where quantity > 0))   as stock_value_at_cost
from public.inventory;

-- Lines still without a cost (set them on the Inventory page, or leave until the next receipt):
select h.name as hub, p.name as product, p.unit, round(i.quantity::numeric, 1) as qty
from public.inventory i join public.products p on p.id = i.product_id join public.hubs h on h.id = i.hub_id
where i.quantity > 0 and i.avg_cost is null
order by i.quantity desc;
