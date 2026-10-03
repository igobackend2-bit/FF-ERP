-- ============================================================================
-- FIX_STOCK_UNIT_DRUMSTICK_2026-10-03.sql
-- Drumstick is counted, bought and sold in KG, but its product unit says "bunch":
--     stock 15 | PO buys at Rs 50-60 per kg | orders sell at about Rs 59.7 per kg (42 lines in 14 days)
-- With the wrong unit the system cannot use the order price for it. This sets the unit to kg on the
-- product and on its stock row (one product named exactly "Drumstick").
--
-- READ BEFORE RUNNING - the product list is also shown on the website: the unit label of
-- "Drumstick" changes from bunch to kg there (the Rs 66 website price is NOT changed).
--
-- Undo block at the bottom. Safe to run twice.
-- ============================================================================

-- BEFORE (read-only)
select p.name, p.unit as product_unit, p.price as website_price,
       (select string_agg(distinct i.unit, ', ') from public.inventory i where i.product_id = p.id) as stock_row_unit,
       (select round(sum(i.quantity)) from public.inventory i where i.product_id = p.id) as stock_qty
from public.products p
where lower(btrim(p.name)) = 'drumstick';

begin;

update public.products set unit = 'kg'
where lower(btrim(name)) = 'drumstick' and lower(btrim(unit)) <> 'kg';

update public.inventory set unit = 'kg'
where product_id in (select id from public.products where lower(btrim(name)) = 'drumstick')
  and lower(btrim(coalesce(unit, ''))) <> 'kg';

commit;

-- AFTER (read-only): both columns should say kg
select p.name, p.unit as product_unit,
       (select string_agg(distinct i.unit, ', ') from public.inventory i where i.product_id = p.id) as stock_row_unit
from public.products p
where lower(btrim(p.name)) = 'drumstick';

-- UNDO (only if needed):
-- begin;
-- update public.products  set unit = 'bunch' where lower(btrim(name)) = 'drumstick';
-- update public.inventory set unit = 'bunch' where product_id in (select id from public.products where lower(btrim(name)) = 'drumstick');
-- commit;
