-- ============================================================================
-- CHECK_INVENTORY_SELLING_PRICE_PREVIEW_2026-10-03.sql   (READ-ONLY - changes nothing)
-- Run AFTER ADD_INVENTORY_SELLING_PRICE_2026-10-03.sql.
-- For every stock line: what we paid (buying cost), what we actually sold it for in recent
-- orders (selling price), and the website price list, side by side, so the numbers can be
-- sanity-checked.
--
-- Read the "flag" column:
--   BELOW COST   selling price is under the buying cost - either we really sell at a loss, or the
--                cost was matched to a different variety (e.g. PO "GUAVA" vs product "Guava White")
--   no cost      no PO rate for this line yet (set it on the Inventory page)
--   no selling   no recent order line to take a price from (unit is litre/box, or not sold lately)
-- ============================================================================

-- A. Line by line (biggest stock value first)
select hub_name                                                  as hub,
       product_name                                              as product,
       unit,
       round(quantity::numeric, 1)                               as qty,
       avg_cost                                                  as buying_cost,
       so_price                                                  as selling_price_from_orders,
       so_lines                                                  as order_lines_used,
       so_window_days                                            as days_window,
       (select p.price from public.products p where p.id = v.product_id) as website_price,
       case when avg_cost > 0 and so_price is not null
            then round((so_price - avg_cost) / so_price * 100, 1) end as margin_pct,
       case when avg_cost > 0 then round(quantity * avg_cost) end       as stock_value_at_cost,
       case when so_price is not null then round(quantity * so_price) end as expected_sales_value,
       case when avg_cost is null or avg_cost <= 0 then 'no cost'
            when so_price is null then 'no selling price'
            when so_price < avg_cost then 'BELOW COST' end        as flag
from public.inventory_valuation_v v
where quantity > 0
order by quantity * coalesce(avg_cost, so_price, 0) desc;

-- B. Totals (profit only counts lines that have BOTH a cost and a selling price)
select round(sum(quantity * avg_cost) filter (where avg_cost > 0))                         as stock_value_at_cost,
       round(sum(quantity * so_price)  filter (where so_price is not null))                as expected_sales_value_all_priced,
       round(sum(quantity * avg_cost)  filter (where avg_cost > 0 and so_price is not null)) as cost_of_lines_with_both,
       round(sum(quantity * so_price)  filter (where avg_cost > 0 and so_price is not null)) as sales_of_lines_with_both,
       round(sum(quantity * (so_price - avg_cost)) filter (where avg_cost > 0 and so_price is not null)) as expected_profit,
       count(*) filter (where avg_cost > 0 and so_price is not null and so_price < avg_cost)  as lines_below_cost,
       count(*) filter (where avg_cost is null or avg_cost <= 0)                              as lines_without_cost,
       count(*) filter (where so_price is null)                                               as lines_without_selling_price
from public.inventory_valuation_v
where quantity > 0;
