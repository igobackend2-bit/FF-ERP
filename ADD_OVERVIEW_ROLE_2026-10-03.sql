-- ============================================================================
-- ADD_OVERVIEW_ROLE_2026-10-03.sql
-- View-only "Management Overview" login (profiles.role = 'overview').
--
-- What it does
--   1. Lets role 'overview' READ four tables whose SELECT is limited to certain
--      roles: cash_collections, daily_cash_closings, ff_vendor_payments,
--      ff_transport_payments. Every other table the overview pages read is already
--      readable by any signed-in user (checked live 2026-10-03).
--   2. Locks WRITES for role 'overview' on every public table (RESTRICTIVE
--      INSERT / UPDATE / DELETE policies, ANDed with the existing ones), except three
--      self-logging tables that every login touches: audit_logs, user_location_logs,
--      notifications. Same lock on storage.objects (file uploads/deletes).
--
-- Why a database lock at all: several tables accept writes from ANY signed-in user
-- today (invoices and vendors use is_staff() for ALL; products_admin_all is true;
-- sales_orders / sales_order_items accept inserts with check true). Hiding buttons
-- alone would not stop a hand-made request.
--
-- Safe to run: idempotent (drop-if-exists then create), one transaction, nothing is
-- deleted, no data changes. If a table is busy for >10 s the script stops and rolls
-- back cleanly - just run it again (best at night, when few people are saving).
-- The lock is inert until someone actually has the role 'overview'.
--
-- Does NOT cover: SECURITY DEFINER functions that write and are callable by any
-- signed-in user (decrement_inventory, decrement_stock, restore_stock,
-- inv_set_min_threshold, check_hub_manager_*). The overview screens never call
-- them; they can only be reached by deliberately crafting an API call.
--
-- KILL SWITCH (undo everything): run the block at the very bottom.
-- ============================================================================

begin;
set local lock_timeout = '10s';

-- ── 1. Read access for the role on role-limited tables ──────────────────────
drop policy if exists overview_read_cash_collections    on public.cash_collections;
drop policy if exists overview_read_daily_cash_closings on public.daily_cash_closings;
drop policy if exists overview_read_ff_vendor_payments  on public.ff_vendor_payments;
drop policy if exists overview_read_ff_transport_payments on public.ff_transport_payments;

create policy overview_read_cash_collections on public.cash_collections
  for select using ((select lower(coalesce(public.get_my_role(), ''))) = 'overview');
create policy overview_read_daily_cash_closings on public.daily_cash_closings
  for select using ((select lower(coalesce(public.get_my_role(), ''))) = 'overview');
create policy overview_read_ff_vendor_payments on public.ff_vendor_payments
  for select using ((select lower(coalesce(public.get_my_role(), ''))) = 'overview');
create policy overview_read_ff_transport_payments on public.ff_transport_payments
  for select using ((select lower(coalesce(public.get_my_role(), ''))) = 'overview');

-- ── 2. Write lock: RESTRICTIVE policies on every public table ───────────────
-- "is distinct from 'overview'" keeps anonymous visitors (website checkout) and every
-- other role working: only a signed-in overview user is refused.
do $$
declare
  t record;
  guard constant text := $g$(select lower(coalesce(public.get_my_role(), ''))) <> 'overview'$g$;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('audit_logs', 'user_location_logs', 'notifications')
  loop
    execute format('drop policy if exists overview_no_insert on public.%I', t.relname);
    execute format('drop policy if exists overview_no_update on public.%I', t.relname);
    execute format('drop policy if exists overview_no_delete on public.%I', t.relname);
    execute format('create policy overview_no_insert on public.%I as restrictive for insert with check (%s)', t.relname, guard);
    execute format('create policy overview_no_update on public.%I as restrictive for update using (%s) with check (%s)', t.relname, guard, guard);
    execute format('create policy overview_no_delete on public.%I as restrictive for delete using (%s)', t.relname, guard);
  end loop;
end $$;

-- ── 3. Same lock on file storage (best effort: storage.objects is owned by Supabase) ─
do $$
declare guard constant text := $g$(select lower(coalesce(public.get_my_role(), ''))) <> 'overview'$g$;
begin
  execute 'drop policy if exists overview_no_insert on storage.objects';
  execute 'drop policy if exists overview_no_update on storage.objects';
  execute 'drop policy if exists overview_no_delete on storage.objects';
  execute format('create policy overview_no_insert on storage.objects as restrictive for insert with check (%s)', guard);
  execute format('create policy overview_no_update on storage.objects as restrictive for update using (%s) with check (%s)', guard, guard);
  execute format('create policy overview_no_delete on storage.objects as restrictive for delete using (%s)', guard);
exception when others then
  raise warning 'storage.objects lock skipped: % (tables are still locked)', sqlerrm;
end $$;

commit;

-- ── 4. VERIFY (read-only) ───────────────────────────────────────────────────
-- 4a. Expect 4 read policies.
select tablename, policyname from pg_policies
where schemaname = 'public' and policyname like 'overview_read_%' order by 1;

-- 4b. Expect lock_tables = (tables with RLS) - 3 and each count = lock_tables.
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) - 3 as expected_tables,
  count(*) filter (where policyname = 'overview_no_insert') as insert_locks,
  count(*) filter (where policyname = 'overview_no_update') as update_locks,
  count(*) filter (where policyname = 'overview_no_delete') as delete_locks
from pg_policies where schemaname = 'public';

-- 4c. Expect 3 rows on storage.objects (0 rows means the best-effort step was skipped).
select policyname from pg_policies where schemaname = 'storage' and policyname like 'overview_no_%';

-- ── 5. AFTER Priya exists: prove it as her (nothing is kept - it rolls back) ─
-- Replace PRIYA-UUID with her id:  select id from profiles where email = 'priya@fferp.in';
-- Reads must return numbers; the update must change 0 rows; the insert must be refused.
--
-- begin;
-- select set_config('request.jwt.claims', json_build_object('sub', 'PRIYA-UUID', 'role', 'authenticated')::text, true);
-- set local role authenticated;
-- select (select count(*) from sales_orders)        as sales_orders,
--        (select count(*) from purchase_orders)     as purchase_orders,
--        (select count(*) from cash_collections)    as cash_collections,
--        (select count(*) from daily_cash_closings) as cash_closings,
--        (select count(*) from ff_vendor_payments)  as vendor_payments,
--        (select count(*) from ff_transport_payments) as transport_payments,
--        (select count(*) from invoices)            as invoices,
--        (select count(*) from inventory)           as stock;
-- do $t$
-- declare n int;
-- begin
--   update public.sales_orders set notes = notes where id = (select id from public.sales_orders limit 1);
--   get diagnostics n = row_count;
--   if n > 0 then raise exception 'LOCK FAILED: update changed % row(s)', n; end if;
--   begin
--     insert into public.hubs(name) values ('__overview_write_test__');
--     raise exception 'LOCK FAILED: insert was allowed';
--   exception when insufficient_privilege then
--     raise notice 'OK: insert refused, update changed 0 rows';
--   end;
-- end $t$;
-- rollback;

-- ── KILL SWITCH — removes the whole feature's database side ─────────────────
-- begin;
-- do $$ declare r record; begin
--   for r in select schemaname, tablename, policyname from pg_policies
--            where policyname like 'overview\_%' escape '\' loop
--     execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
--   end loop; end $$;
-- commit;
