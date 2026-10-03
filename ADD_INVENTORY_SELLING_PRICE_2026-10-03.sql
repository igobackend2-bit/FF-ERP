-- ============================================================================
-- ADD_INVENTORY_SELLING_PRICE_2026-10-03.sql
-- The price we ACTUALLY sell each stocked product at, taken from real sales orders (not the
-- website price list), shown beside the buying cost so margin and expected profit are visible.
--
-- How inv_so_rate() works
--   * lines of sales orders that are not cancelled, last 7 days (else last 30 days);
--   * line matched to the product by product_id, exact name, or - if neither exists - by a
--     whole-word prefix (order line "Onion" -> product "Onion Nasik");
--   * unit family: kg products use the kg lines (qty_kg), piece products use piece/pcs/pc
--     lines, bunch products use bunch lines. Other units (litre, box, pack) -> no price,
--     because order lines do not carry them reliably;
--   * revenue = the line's total_price (so discounts are already in), falling back to
--     unit_price x quantity; lines priced outside 1/4x..4x of the website price are dropped
--     as typos;
--   * result = quantity-weighted average: total revenue / total quantity. It also returns how
--     many lines and which window it used, so the number can be checked.
--
-- inventory_valuation_v: one row per stock line with quantity, buying cost (avg_cost) and
-- selling price (so_price) side by side. security_invoker: it shows exactly what the viewer is
-- allowed to read, nothing more.
--
-- Safe to run: read-only objects only (one function, one view). No table is changed.
-- ============================================================================

begin;

create or replace function public.inv_so_rate(p_product uuid, p_as_of timestamptz default now())
returns table(rate numeric, lines_used integer, window_days integer)
language sql stable set search_path = public as $$
  with p as (
    select id as pid,
           lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as pn,
           lower(btrim(unit)) as unit,
           nullif(price, 0) as price
    from public.products where id = p_product
  ),
  fam as (
    select p.*,
           case p.unit when 'kg'    then array['kg']
                       when 'piece' then array['piece', 'pcs', 'pc']
                       when 'bunch' then array['bunch']
                       else array[]::text[] end as units
    from p
  ),
  cand as (
    select soi.total_price, soi.unit_price, so.created_at,
           case when lower(btrim(soi.unit)) = 'kg' then soi.qty_kg else soi.quantity end as q,
           case when soi.product_id = fam.pid or nm.v = fam.pn then 1 else 2 end as tier
    from fam
    cross join public.sales_order_items soi
    join public.sales_orders so on so.id = soi.order_id
    cross join lateral (
      select lower(regexp_replace(btrim(soi.product_name), '\s+', ' ', 'g')) as v
    ) nm
    where lower(btrim(soi.unit)) = any (fam.units)
      and so.status is distinct from 'cancelled'
      and so.created_at <= p_as_of
      and so.created_at >  p_as_of - interval '30 days'
      and soi.unit_price > 0
      and (soi.product_id = fam.pid or nm.v = fam.pn or fam.pn like nm.v || ' %')
      and (fam.price is null or soi.unit_price between fam.price / 4 and fam.price * 4)
  ),
  c2   as (select *, coalesce(nullif(total_price, 0), unit_price * q) as rev from cand where q > 0),
  best as (select * from c2 where tier = (select min(tier) from c2)),
  w7   as (select sum(rev) as r, sum(q) as q, count(*) as n from best where created_at > p_as_of - interval '7 days'),
  w30  as (select sum(rev) as r, sum(q) as q, count(*) as n from best)
  select round(case when w7.n > 0 then w7.r / w7.q else w30.r / w30.q end, 2),
         (case when w7.n > 0 then w7.n else w30.n end)::integer,
         case when w7.n > 0 then 7 else 30 end
  from w7, w30
  where w30.n > 0;
$$;

create or replace view public.inventory_valuation_v
with (security_invoker = true) as
select i.id,
       i.hub_id,
       h.name                                   as hub_name,
       i.product_id,
       coalesce(p.name, i.product_name)         as product_name,
       coalesce(p.unit, i.unit)                 as unit,
       i.quantity,
       i.min_threshold,
       i.updated_at,
       i.avg_cost,
       i.cost_source,
       so.rate                                  as so_price,
       so.lines_used                            as so_lines,
       so.window_days                           as so_window_days
from public.inventory i
join public.products p on p.id = i.product_id
left join public.hubs h on h.id = i.hub_id
left join lateral public.inv_so_rate(i.product_id, now()) so on true;

revoke all on public.inventory_valuation_v from public, anon;
grant select on public.inventory_valuation_v to authenticated, service_role;
revoke all on function public.inv_so_rate(uuid, timestamptz) from public, anon;
grant execute on function public.inv_so_rate(uuid, timestamptz) to authenticated, service_role;

commit;

-- VERIFY (read-only)
-- Expect 1 row each.
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_so_rate';

select count(*) as stock_lines,
       count(so_price) as lines_with_selling_price,
       count(avg_cost) as lines_with_cost
from public.inventory_valuation_v where quantity > 0;
