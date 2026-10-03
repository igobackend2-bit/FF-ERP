-- ============================================================================
-- ADD_INVENTORY_COST_2026-10-04.sql
-- Value stock at what we PAID (moving-average purchase cost), not at selling price.
--
--   Buy 2 kg @ Rs 100  -> stock 2 kg, value Rs 200
--   Sell 1 kg @ Rs 110 -> stock 1 kg, value Rs 100  (the Rs 10 is profit, not stock)
--   Buy 1 kg @ Rs 130  -> stock 2 kg, average cost Rs 115, value Rs 230
--
-- How the buying rate is found (automatic, no QC form change):
--   inv_po_rate() looks at purchase-order lines of the last 3 days (else 14 days) whose item
--   name equals the product name, or whose name is a whole-word prefix of it (PO "ONION" ->
--   product "Onion Nasik"). Only KG lines, only for products stocked in kg (PO lines carry no
--   other unit). Rates outside 1/4x..4x of the product's selling price are ignored as typos
--   (live data had Tomato at Rs 450-600/kg). The MEDIAN of what is left is used.
--   No match -> NULL: the cost stays "not set" and is never guessed.
--
-- What changes
--   * new nullable columns (nothing existing is altered):
--       inventory.avg_cost / cost_source / cost_updated_at, inventory_log.unit_cost,
--       qc_inspections.unit_cost / unit_cost_source
--   * inv__move gets an optional 9th argument p_unit_cost (old 8-argument calls keep working).
--     Receipts with a cost update the average; sales, wastage and adjustments leave the
--     average unchanged and log the cost they left at.
--   * increment_inventory (QC receipt) looks up the PO rate itself, passes it on and stamps
--     qc_inspections. A failed lookup never blocks a QC receipt.
--   * inv_set_unit_cost(): admin / ff_operations_manager / accounts correct a stock line's cost.
--
-- Safe to run: additive, idempotent, one transaction. Nothing changes for staff until a QC
-- receipt happens. Run APPLY_INVENTORY_OPENING_COST_2026-10-04.sql afterwards for the stock
-- that is already on the shelf (look at CHECK_INVENTORY_COST_PREVIEW first).
-- ============================================================================

begin;
set local lock_timeout = '10s';

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.inventory
  add column if not exists avg_cost        numeric(12,4),
  add column if not exists cost_source     text,
  add column if not exists cost_updated_at timestamptz;
alter table public.inventory_log
  add column if not exists unit_cost numeric(12,4);
alter table public.qc_inspections
  add column if not exists unit_cost        numeric(12,4),
  add column if not exists unit_cost_source text;

-- ── 2. PO rate lookup ───────────────────────────────────────────────────────
create or replace function public.inv_po_rate(p_product uuid, p_as_of timestamptz default now())
returns table(rate numeric, source text, lines_used integer)
language sql stable security definer set search_path = public as $$
  with p as (
    select lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as pn,
           lower(btrim(unit)) as unit,
           nullif(price, 0) as price
    from public.products where id = p_product
  ),
  cand as (
    select poi.unit_price::numeric as rate, po.created_at,
           case when nm.v = p.pn then 1 else 2 end as tier
    from p
    cross join public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.po_id
    cross join lateral (
      select lower(regexp_replace(btrim(coalesce(poi.item_name, poi.product_name)), '\s+', ' ', 'g')) as v
    ) nm
    where p.unit = 'kg'
      and lower(btrim(poi.unit)) = 'kg'
      and poi.unit_price > 0
      and po.status is distinct from 'cancelled'
      and po.created_at <= p_as_of
      and po.created_at >  p_as_of - interval '14 days'
      and (nm.v = p.pn or p.pn like nm.v || ' %')
      and (p.price is null or poi.unit_price between p.price / 4 and p.price * 4)
  ),
  best as (select * from cand where tier = (select min(tier) from cand)),
  r3   as (select percentile_cont(0.5) within group (order by rate)::numeric as m, count(*)::integer as n
           from best where created_at > p_as_of - interval '3 days'),
  r14  as (select percentile_cont(0.5) within group (order by rate)::numeric as m, count(*)::integer as n
           from best)
  select round(coalesce(r3.m, r14.m), 2),
         case when r3.m is not null then 'po_3d' else 'po_14d' end
           || case when (select min(tier) from best) = 1 then '_exact' else '_prefix' end,
         case when r3.m is not null then r3.n else r14.n end
  from r3, r14
  where coalesce(r3.m, r14.m) is not null;
$$;

-- ── 3. inv__move with cost (drop the 8-arg version so calls cannot be ambiguous) ────
drop function if exists public.inv__move(uuid, uuid, numeric, text, text, uuid, text, uuid);

create or replace function public.inv__move(
  p_hub uuid, p_product uuid, p_delta numeric, p_event text, p_ref_type text,
  p_ref_id uuid, p_notes text, p_user uuid, p_unit_cost numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.inventory; v_old numeric; v_new numeric; v_applied numeric;
  v_avg numeric; v_src text; v_log_cost numeric;
begin
  if p_hub is null or p_product is null or coalesce(p_delta, 0) = 0 then return 0; end if;

  insert into public.inventory (hub_id, product_id, quantity)
  values (p_hub, p_product, 0)
  on conflict (hub_id, product_id) do nothing;

  select * into v_inv from public.inventory where hub_id = p_hub and product_id = p_product for update;
  v_old     := coalesce(v_inv.quantity, 0);
  v_new     := greatest(0, v_old + p_delta);
  v_applied := round((v_new - v_old)::numeric, 3);
  v_avg := v_inv.avg_cost; v_src := v_inv.cost_source; v_log_cost := v_inv.avg_cost;

  if v_applied = 0 and p_delta < 0 then
    -- nothing on hand to deduct; still record the attempt so the register explains itself
    insert into public.inventory_log (inventory_id, hub_id, product_id, event_type, qty_delta, ref_id, ref_type, notes, created_by, unit_cost)
    values (v_inv.id, p_hub, p_product, p_event, 0, p_ref_id, p_ref_type,
            coalesce(p_notes || ' · ', '') || 'requested ' || p_delta || ' but stock was 0', p_user, v_log_cost);
    return 0;
  end if;

  -- A receipt with a known cost updates the moving average. Everything else leaves it alone,
  -- so stock leaves at the average and what is left stays valued at what we paid.
  if v_applied > 0 and coalesce(p_unit_cost, 0) > 0 then
    if v_avg is not null and v_old > 0 then
      v_avg := round(((v_old * v_avg) + (v_applied * p_unit_cost)) / (v_old + v_applied), 4);
    else
      v_avg := round(p_unit_cost, 4);          -- first costed batch, or stock had run to zero
    end if;
    v_src := 'receipt';
    v_log_cost := p_unit_cost;
  end if;

  update public.inventory
     set quantity = v_new, updated_at = now(), avg_cost = v_avg, cost_source = v_src,
         cost_updated_at = case when v_avg is distinct from v_inv.avg_cost then now() else v_inv.cost_updated_at end
   where id = v_inv.id;

  insert into public.inventory_log (inventory_id, hub_id, product_id, event_type, qty_delta, ref_id, ref_type, notes, created_by, unit_cost)
  values (v_inv.id, p_hub, p_product, p_event, v_applied, p_ref_id, p_ref_type,
          case when v_applied <> p_delta
               then coalesce(p_notes || ' · ', '') || 'requested ' || p_delta || ', limited by stock on hand'
               else p_notes end,
          p_user, v_log_cost);
  return v_applied;
end $$;

revoke all on function public.inv__move(uuid, uuid, numeric, text, text, uuid, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.inv__move(uuid, uuid, numeric, text, text, uuid, text, uuid, numeric) to service_role;

-- ── 4. QC receipt: look up the PO rate, pass it on, stamp the inspection ────
create or replace function public.increment_inventory(
  p_hub_id uuid, p_product_id uuid, p_grade_a numeric, p_grade_b numeric, p_grade_c numeric,
  p_inspection_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric := coalesce(p_grade_a, 0) + coalesce(p_grade_b, 0) + coalesce(p_grade_c, 0);
  v_rate numeric; v_src text;
begin
  if v_total <= 0 then return; end if;

  begin   -- a failed rate lookup must never block a QC receipt
    select r.rate, r.source into v_rate, v_src from public.inv_po_rate(p_product_id, now()) r;
  exception when others then
    v_rate := null; v_src := null;
  end;

  perform public.inv__move(p_hub_id, p_product_id, v_total, 'qc_receive', 'qc_inspection',
                           p_inspection_id, 'QC inspection', auth.uid(), v_rate);

  if p_inspection_id is not null then
    begin
      update public.qc_inspections
         set unit_cost = v_rate, unit_cost_source = coalesce(v_src, 'no_po_rate')
       where id = p_inspection_id;
    exception when others then null;
    end;
  end if;
end $$;

-- ── 5. Admin correction of a stock line's cost ──────────────────────────────
create or replace function public.inv_set_unit_cost(p_hub uuid, p_product uuid, p_cost numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_inv public.inventory;
begin
  if lower(coalesce(public.get_my_role(), '')) not in ('admin', 'ff_operations_manager', 'accounts') then
    raise exception 'Only admin, FF operations manager or accounts can set a stock cost';
  end if;
  if p_cost is null or p_cost <= 0 then raise exception 'Cost must be more than zero'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;

  select * into v_inv from public.inventory where hub_id = p_hub and product_id = p_product for update;
  if not found then raise exception 'No stock row for this product at this hub'; end if;

  update public.inventory
     set avg_cost = round(p_cost, 4), cost_source = 'manual', cost_updated_at = now()
   where id = v_inv.id;

  insert into public.inventory_log (inventory_id, hub_id, product_id, event_type, qty_delta, ref_type, notes, created_by, unit_cost)
  values (v_inv.id, p_hub, p_product, 'adjustment', 0, 'adjustment',
          'Cost set to Rs ' || round(p_cost, 2) || ' per unit: ' || btrim(p_reason), auth.uid(), round(p_cost, 4));
end $$;

revoke all on function public.inv_set_unit_cost(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.inv_set_unit_cost(uuid, uuid, numeric, text) to authenticated, service_role;
revoke all on function public.inv_po_rate(uuid, timestamptz) from public, anon;
grant execute on function public.inv_po_rate(uuid, timestamptz) to authenticated, service_role;

commit;

-- ── 6. VERIFY (read-only) ───────────────────────────────────────────────────
-- 6a. Expect 4 rows: inv__move has 9 args and exactly ONE version exists.
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('inv__move', 'increment_inventory', 'inv_po_rate', 'inv_set_unit_cost') order by 1;

-- 6b. Expect 6 rows (the new columns).
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'inventory' and column_name in ('avg_cost', 'cost_source', 'cost_updated_at'))
    or (table_name = 'inventory_log' and column_name = 'unit_cost')
    or (table_name = 'qc_inspections' and column_name in ('unit_cost', 'unit_cost_source')))
order by 1, 2;

-- ── 7. OPTIONAL TEST of the worked example (nothing is kept: it rolls back) ─
-- Expected notices: after +2 @100: qty 2 / avg 100 | after sale 1: qty 1 / avg 100 / value 100
--                   after +1 @130: qty 2 / avg 115 / value 230
--
-- begin;
-- do $t$
-- declare h uuid; p uuid; r record;
-- begin
--   select id into h from public.hubs order by name limit 1;
--   insert into public.products (name, unit, is_active) values ('__cost_test__', 'kg', true) returning id into p;
--   perform public.inv__move(h, p,  2, 'qc_receive', 'qc_inspection', null, 'test', null, 100);
--   select quantity, avg_cost into r from public.inventory where hub_id = h and product_id = p;
--   raise notice 'after +2 @100: qty % avg %', r.quantity, r.avg_cost;
--   perform public.inv__move(h, p, -1, 'sale', 'sales_order', null, 'test', null);
--   select quantity, avg_cost into r from public.inventory where hub_id = h and product_id = p;
--   raise notice 'after selling 1: qty % avg % value %', r.quantity, r.avg_cost, r.quantity * r.avg_cost;
--   perform public.inv__move(h, p,  1, 'qc_receive', 'qc_inspection', null, 'test', null, 130);
--   select quantity, avg_cost into r from public.inventory where hub_id = h and product_id = p;
--   raise notice 'after +1 @130: qty % avg % value %', r.quantity, r.avg_cost, r.quantity * r.avg_cost;
-- end $t$;
-- rollback;
