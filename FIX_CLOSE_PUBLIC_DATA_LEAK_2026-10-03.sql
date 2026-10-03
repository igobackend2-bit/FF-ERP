-- ============================================================================
-- FIX_CLOSE_PUBLIC_DATA_LEAK_2026-10-03.sql
--
-- WHAT WAS WRONG (checked live 2026-10-03)
--   The website key (anon) that is visible to every visitor could:
--     * READ  customers (417 rows), sales_orders (1,035), sales_order_items (10,244)
--     * CHANGE products (confirmed: a product's price), coupons (e.g. create a 100%-off coupon),
--       banners, farm_stories, farm_streams
--     * INSERT fake rows into customers / sales_orders / sales_order_items (fake orders reach the
--       ERP and the EOD purchase-order engine)
--   Cause: policies written as `true` for everyone (products_admin_all, coupons_admin_all,
--   banners_admin_all, farm_*_admin_all, customers_anon_read, customers_anon_insert,
--   sales_orders_select_all, sales_orders_insert_all, soi_select_all, soi_insert_all).
--
-- WHAT THIS DOES
--   0. Fixes a mistake of mine: the customer block was also applied to `leads`, so logged-in customers
--      could not submit the lead form (403). Removed from `leads`.
--   1. Drops the open "admin" policies on banners / farm_stories / farm_streams (an admin-only policy
--      already exists on each) and REPLACES them on products and coupons with "ERP staff only"
--      (any active profile that is not a customer) - the QC form, Items, Product Catalog and Damage
--      screens add products and keep working.
--   2. customers / sales_orders / sales_order_items: drops the open READ policies, and REPLACES the open
--      INSERT policies with "ERP staff only" (Bulk Order, Tele-caller Take Order, Sales Orders keep working).
--   3. Customer sign-up accounts can no longer read those three tables through the "any signed-in user"
--      policies (block_customer_accounts added).
--   Untouched: public READ of products, banners, site_settings, farm_*, reviews, announcements; anon
--   writes to analytics_events and leads; customers' own cart / wishlist / addresses / profile / shop
--   orders; everything the website server does with its service key; staff and Priya's read access.
--
-- KNOWN SIDE EFFECT: the old customer portal page inside this ERP (fferp.in/customer -> Cart) saves an
--   order straight into customers / sales_orders as the logged-in customer. That will now be refused.
--   The API logs show nobody used it in the last 3 days; the shop places orders through its own `orders`
--   table, which is not touched.
--
-- Safe to run: idempotent, one transaction, stops cleanly if a table is busy >10 s (run again).
-- KILL SWITCH at the bottom restores the old (open) policies.
-- ============================================================================

begin;
set local lock_timeout = '10s';

-- ── helper: "ERP staff" = an active profile that is NOT a customer sign-up ──────────────
create or replace function public.is_erp_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active is not false
      and lower(coalesce(role, '')) not in ('user', 'customer')
  );
$$;
revoke all on function public.is_erp_staff() from public;
grant execute on function public.is_erp_staff() to anon, authenticated, service_role;

-- ── 0. regression fix: customers must be able to submit leads ──────────────────────────
drop policy if exists block_customer_accounts on public.leads;

-- ── 1. catalogue: no more "anyone can change it" ───────────────────────────────────────
drop policy if exists products_admin_all   on public.products;
drop policy if exists products_erp_staff_write on public.products;
create policy products_erp_staff_write on public.products
  for all using ((select public.is_erp_staff())) with check ((select public.is_erp_staff()));

drop policy if exists coupons_admin_all    on public.coupons;
drop policy if exists coupons_staff_write  on public.coupons;
drop policy if exists coupons_erp_staff_write on public.coupons;
create policy coupons_erp_staff_write on public.coupons
  for all using ((select public.is_erp_staff())) with check ((select public.is_erp_staff()));

drop policy if exists banners_admin_all       on public.banners;
drop policy if exists farm_stories_admin_all  on public.farm_stories;
drop policy if exists farm_streams_admin_all  on public.farm_streams;

-- ── 2. customer / order data: no anonymous read, staff-only insert ────────────────────
drop policy if exists customers_anon_read   on public.customers;
drop policy if exists customers_anon_insert on public.customers;
drop policy if exists customers_erp_staff_insert on public.customers;
create policy customers_erp_staff_insert on public.customers
  for insert with check ((select public.is_erp_staff()));

drop policy if exists sales_orders_select_all  on public.sales_orders;
drop policy if exists sales_orders_insert_all  on public.sales_orders;
drop policy if exists sales_orders_erp_staff_insert on public.sales_orders;
create policy sales_orders_erp_staff_insert on public.sales_orders
  for insert with check ((select public.is_erp_staff()));

drop policy if exists soi_select_all  on public.sales_order_items;
drop policy if exists soi_insert_all  on public.sales_order_items;
drop policy if exists soi_erp_staff_insert on public.sales_order_items;
create policy soi_erp_staff_insert on public.sales_order_items
  for insert with check ((select public.is_erp_staff()));

-- ── 3. customer sign-up accounts cannot read them via "any signed-in user" policies ────
do $$
declare
  t text;
  guard constant text :=
    $g$(select lower(coalesce(public.get_my_role(), ''))) not in ('user', 'customer')$g$;
begin
  foreach t in array array['customers', 'sales_orders', 'sales_order_items'] loop
    execute format('drop policy if exists block_customer_accounts on public.%I', t);
    execute format(
      'create policy block_customer_accounts on public.%I as restrictive for all using (%s) with check (%s)',
      t, guard, guard);
  end loop;
end $$;

commit;

-- ── VERIFY (read-only) ──────────────────────────────────────────────────────────────────
-- Expect: none of the open policies remain (0 rows).
select tablename, policyname from pg_policies
where schemaname = 'public' and policyname in (
  'products_admin_all','coupons_admin_all','banners_admin_all','farm_stories_admin_all','farm_streams_admin_all',
  'customers_anon_read','customers_anon_insert','sales_orders_select_all','sales_orders_insert_all',
  'soi_select_all','soi_insert_all');

-- Expect: 3 rows (block policy on the three customer-data tables) and none on leads.
select tablename from pg_policies
where schemaname = 'public' and policyname = 'block_customer_accounts'
  and tablename in ('customers', 'sales_orders', 'sales_order_items', 'leads') order by 1;

-- ── PROOF AS A VISITOR (nothing is kept - rolls back) ─────────────────────────────────
-- Expect: customers 0, sales_orders 0, sales_order_items 0, products_still_visible > 0,
--         products_changeable 0.
-- begin;
-- set local role anon;
-- with a as (update public.products set price = price
--            where id = (select id from public.products order by created_at limit 1) returning 1)
-- select (select count(*) from public.customers)         as customers,
--        (select count(*) from public.sales_orders)      as sales_orders,
--        (select count(*) from public.sales_order_items) as sales_order_items,
--        (select count(*) from public.products)          as products_still_visible,
--        (select count(*) from a)                        as products_changeable;
-- rollback;

-- ── KILL SWITCH - puts the old open policies back (only if something breaks) ───────────
-- begin;
-- create policy products_admin_all on public.products for all using (true) with check (true);
-- create policy coupons_admin_all on public.coupons for all using (true) with check (true);
-- create policy banners_admin_all on public.banners for all using (true) with check (true);
-- create policy farm_stories_admin_all on public.farm_stories for all using (true) with check (true);
-- create policy farm_streams_admin_all on public.farm_streams for all using (true) with check (true);
-- create policy customers_anon_read on public.customers for select using (true);
-- create policy customers_anon_insert on public.customers for insert with check (true);
-- create policy sales_orders_select_all on public.sales_orders for select using (true);
-- create policy sales_orders_insert_all on public.sales_orders for insert with check (true);
-- create policy soi_select_all on public.sales_order_items for select using (true);
-- create policy soi_insert_all on public.sales_order_items for insert with check (true);
-- drop policy if exists block_customer_accounts on public.customers;
-- drop policy if exists block_customer_accounts on public.sales_orders;
-- drop policy if exists block_customer_accounts on public.sales_order_items;
-- commit;
