-- ============================================================================
-- ADD_COST_MATCHING_V2_2026-10-03.sql
-- Smarter way to find the buying price of a stocked product from purchase orders.
-- Replaces inv_po_rate() only (same name, same arguments, same result columns).
--
-- Why: 27 stock lines had no cost. Most of them DO have a PO price, but the names are written
-- differently ("CARROT" vs "Carrots", "BRINJAL(VARI)" vs "Brinjal Vari", "ARAIKEERAI" vs
-- "ARAI KEERAI", "ARVI / SEPPANKIZHANGU", "MUSHROOM" vs "Button Mushrooms").
--
-- What changes in the matching (best tier wins; then the median of that tier's rates is used):
--   1. same name once spaces / brackets / punctuation are ignored and a trailing "s" is dropped
--      (CARROT = Carrots, BRINJAL(VARI) = Brinjal Vari, ARAIKEERAI = ARAI KEERAI)
--   2. the PO name is a whole-word start of the product name (PO ONION -> Onion Nasik)
--   3. the product's words all appear in a longer PO name (ARVI / SEPPANKIZHANGU -> Seppankizhangu)
--   4. the PO's words all appear in the product name (PO MUSHROOM -> Button Mushrooms,
--      PO CHILLI -> Bullet Chilli)
--   Everything else is unchanged: last 3 days else 14 days, cancelled POs ignored, rates outside
--   1/4x..4x of the website price dropped as typos, median not average.
--
-- Also: products stocked in PIECE or BUNCH can now get a cost. Every PO line is labelled "kg" in the
-- database, but for items like raw banana (PO median Rs 8, sold Rs 12 per piece), cauliflower
-- (Rs 20 vs Rs 26 per piece) and mint (Rs 5 vs Rs 7 per bunch) the buyers clearly type the price
-- per piece / bunch. Those rates are used AS ENTERED and marked "_as_entered" in `source`.
-- Litre / box / pack products still get no automatic cost.
--
-- Safe to run: replaces one function, changes no data. Nothing is applied to stock until you run
-- APPLY_INVENTORY_OPENING_COST_2026-10-04.sql, and CHECK_INVENTORY_COST_PREVIEW_2026-10-04.sql
-- shows every rate first.
-- ============================================================================

begin;

create or replace function public.inv_po_rate(p_product uuid, p_as_of timestamptz default now())
returns table(rate numeric, source text, lines_used integer)
language sql stable security definer set search_path = public as $$
  with p as (
    select regexp_replace(regexp_replace(lower(name), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g') as pn_raw,
           lower(btrim(unit)) as unit,
           nullif(price, 0) as price
    from public.products where id = p_product
  ),
  pk as (
    select btrim(pn_raw) as pn,
           regexp_replace(regexp_replace(pn_raw, '\s+', '', 'g'), 's$', '') as pkey,
           unit, price
    from p
    where unit in ('kg', 'piece', 'bunch')
  ),
  po as (
    select poi.unit_price::numeric as rate, o.created_at,
           btrim(regexp_replace(regexp_replace(lower(coalesce(poi.item_name, poi.product_name)),
                                               '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g')) as nm
    from public.purchase_order_items poi
    join public.purchase_orders o on o.id = poi.po_id
    where poi.unit_price > 0
      and o.status is distinct from 'cancelled'
      and o.created_at <= p_as_of
      and o.created_at >  p_as_of - interval '14 days'
  ),
  po2 as (
    select *, regexp_replace(regexp_replace(nm, '\s+', '', 'g'), 's$', '') as nkey
    from po where nm <> ''
  ),
  cand as (
    select po2.rate, po2.created_at,
           case
             when po2.nkey = pk.pkey then 1
             when pk.pn like po2.nm || ' %' then 2
             when (select bool_and(regexp_replace(w, 's$', '') = any (
                           select regexp_replace(x, 's$', '') from unnest(string_to_array(po2.nm, ' ')) x))
                   from unnest(string_to_array(pk.pn, ' ')) w) then 3
             when (select bool_and(regexp_replace(w, 's$', '') = any (
                           select regexp_replace(x, 's$', '') from unnest(string_to_array(pk.pn, ' ')) x))
                   from unnest(string_to_array(po2.nm, ' ')) w) then 4
           end as tier
    from pk cross join po2
    where pk.price is null or po2.rate between pk.price / 4 and pk.price * 4
  ),
  c2   as (select * from cand where tier is not null),
  best as (select * from c2 where tier = (select min(tier) from c2)),
  r3   as (select percentile_cont(0.5) within group (order by rate)::numeric as m, count(*)::integer as n
           from best where created_at > p_as_of - interval '3 days'),
  r14  as (select percentile_cont(0.5) within group (order by rate)::numeric as m, count(*)::integer as n
           from best)
  select round(coalesce(r3.m, r14.m), 2),
         (case when r3.m is not null then 'po_3d' else 'po_14d' end)
           || (case (select min(tier) from best)
                 when 1 then '_same_name' when 2 then '_prefix' when 3 then '_name_in_po' else '_po_in_name' end)
           || (case when (select unit from pk) = 'kg' then '' else '_as_entered' end),
         case when r3.m is not null then r3.n else r14.n end
  from r3, r14
  where coalesce(r3.m, r14.m) is not null;
$$;

commit;

-- VERIFY (read-only): expect 1 row (same signature as before)
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc where pronamespace = 'public'::regnamespace and proname = 'inv_po_rate';

-- Quick look at three of the fixed names (needs the product to exist; any result row = it matches now):
select p.name, r.rate, r.source, r.lines_used
from public.products p
cross join lateral public.inv_po_rate(p.id, now()) r
where p.name in ('Carrots', 'Brinjal Vari', 'ARAI KEERAI', 'Seppankizhangu', 'Button Mushrooms')
order by p.name;
