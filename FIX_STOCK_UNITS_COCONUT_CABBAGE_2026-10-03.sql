-- ============================================================================
-- FIX_STOCK_UNITS_COCONUT_CABBAGE_2026-10-03.sql
-- Coconut and Cabbage are counted and bought in KG, but their product unit says something else:
--     Coconut  -> "litre"   (stock 530 kg; PO buys at Rs 50-70 per kg; orders sell at ~Rs 62 per kg)
--     Cabbage  -> "piece"   (stock 190 kg; PO buys at ~Rs 15 per kg; orders sell at ~Rs 21 per kg)
-- With the wrong unit the system cannot use the PO price or the order price for them.
-- This sets the unit to kg on the product and on its stock rows.
--
-- READ BEFORE RUNNING - this touches the PRODUCT list, which the website also shows:
--   * the unit label of "Coconut" and "Cabbage" on the website changes from litre / piece to kg;
--   * website prices are NOT changed (Coconut shows Rs 170, Cabbage Rs 22), so check that those
--     prices really are per kg. A separate "Fresh Coconut" product (Rs 70 per kg) already exists.
--   * Raw Banana and Cauliflower stay in "piece" - you confirmed they are counted in pieces.
--
-- Undo: the old values are in the last block (commented). Safe to run twice.
-- ============================================================================

-- BEFORE (read-only): note these values
select p.name, p.unit as product_unit, p.price as website_price,
       (select string_agg(distinct i.unit, ', ') from public.inventory i where i.product_id = p.id) as stock_row_unit,
       (select round(sum(i.quantity)) from public.inventory i where i.product_id = p.id) as stock_qty
from public.products p
where lower(btrim(p.name)) in ('coconut', 'cabbage');

begin;

update public.products set unit = 'kg'
where lower(btrim(name)) in ('coconut', 'cabbage')
  and lower(btrim(unit)) <> 'kg';

update public.inventory set unit = 'kg'
where product_id in (select id from public.products where lower(btrim(name)) in ('coconut', 'cabbage'))
  and lower(btrim(coalesce(unit, ''))) <> 'kg';

commit;

-- AFTER (read-only): all four columns should now say kg
select p.name, p.unit as product_unit,
       (select string_agg(distinct i.unit, ', ') from public.inventory i where i.product_id = p.id) as stock_row_unit
from public.products p
where lower(btrim(p.name)) in ('coconut', 'cabbage');

-- UNDO (only if needed):
-- begin;
-- update public.products  set unit = 'litre' where lower(btrim(name)) = 'coconut';
-- update public.inventory set unit = 'litre' where product_id in (select id from public.products where lower(btrim(name)) = 'coconut');
-- update public.products  set unit = 'piece' where lower(btrim(name)) = 'cabbage';
-- update public.inventory set unit = 'piece' where product_id in (select id from public.products where lower(btrim(name)) = 'cabbage');
-- commit;
