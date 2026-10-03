-- ============================================================================
-- FIX_BLOCK_CUSTOMER_ACCOUNTS_FROM_STAFF_DATA_2026-10-03.sql
--
-- WHY
--   Anyone can sign in at fferp.in/customer (or the shop website/app) with a mobile OTP.
--   handle_new_user() gives every sign-up a row in `profiles` with role 'user'. is_staff() is
--   true for ANY active profile, and several policies say "any signed-in user", so a customer
--   account could read vendor bank details, purchase orders and payments, and write invoices
--   and vendors (checked live 2026-10-03 by impersonating one: 412 customers, 116 vendors'
--   bank details, 1,860 purchase orders visible).
--
-- WHAT THIS DOES
--   Adds one RESTRICTIVE policy "block_customer_accounts" (all commands) to every public table
--   EXCEPT a keep-list of customer-facing tables (products, carts, wishlists, addresses,
--   own profile, notifications, hubs, delivery slots, ...). The policy refuses profiles whose
--   role is 'user' or 'customer'. Staff, admin, the Overview login and anonymous visitors
--   (website checkout) are untouched; customers keep everything the shop needs.
--
--   Evidence it is safe: every order in the last 30 days (643 website orders) was created by a
--   staff field-executive login; customer accounts have 0 orders of their own.
--
-- UPDATE 2026-10-03 (later): the anonymous read/insert holes on customers, sales_orders and
--   sales_order_items are closed by FIX_CLOSE_PUBLIC_DATA_LEAK_2026-10-03.sql, and those three tables
--   are no longer on this file's keep-list.
--
-- Safe to run: additive, idempotent, one transaction, stops cleanly if a table is busy >10 s
-- (just run again). KILL SWITCH at the bottom removes it in one statement.
-- ============================================================================

begin;
set local lock_timeout = '10s';

do $$
declare
  t record;
  -- customer-facing / shared tables that must stay reachable for a signed-in customer
  keep constant text[] := array[
    'Account', 'Session', 'User', 'VerificationToken', 'verification_tokens', 'sessions', 'accounts',
    'account_deletion_requests', 'addresses', 'customer_addresses', 'user_addresses',
    'customer_notifications', 'customer_profiles', 'customer_queries', 'customer_wishlists',
    'leads', 'cart', 'cart_items', 'carts', 'wishlist', 'wishlist_items', 'wishlists',   -- 'leads' added: customers submit the lead form
    'orders', 'order_items', 'order_tracking', 'order_cancellations', 'order_returns', 'refunds',
    'reviews', 'product_reviews', 'product_images', 'products', 'categories', 'product_categories',
    'coupons', 'coupon_usage', 'subscriptions', 'subscription_items', 'banners', 'app_banners',
    'app_config', 'app_sessions', 'site_settings', 'system_settings', 'web_access_config',
    'contact_enquiries', 'feedback', 'stock_notifications', 'stock_alerts', 'push_tokens',
    'device_tokens', 'notifications', 'notification_settings', 'analytics_events', 'farm_stories',
    'farm_streams', 'market_rates', 'delivery_slots', 'delivery_zones', 'hub_pincodes', 'hubs',
    'announcements', 'user_location_logs', 'audit_logs',   -- customers / sales_orders / sales_order_items now BLOCKED (see FIX_CLOSE_PUBLIC_DATA_LEAK)
    'profiles', 'cafe_ads', 'cafe_master_menu', 'cafe_menu_items', 'cafe_orders',
    'cafe_order_items', 'cafe_settings'
  ];
  guard constant text :=
    $g$(select lower(coalesce(public.get_my_role(), ''))) not in ('user', 'customer')$g$;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname <> all (keep)
  loop
    execute format('drop policy if exists block_customer_accounts on public.%I', t.relname);
    execute format(
      'create policy block_customer_accounts on public.%I as restrictive for all using (%s) with check (%s)',
      t.relname, guard, guard);
  end loop;
end $$;

commit;

-- ── VERIFY (read-only) ──────────────────────────────────────────────────────
-- Expect: policies = (tables with RLS) - 70 kept tables (expect 205).
select count(*) as tables_blocked_for_customers
from pg_policies where schemaname = 'public' and policyname = 'block_customer_accounts';

-- The kept tables that actually exist (for reference):
select string_agg(c.relname, ', ' order by c.relname) as kept_for_customers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not exists (select 1 from pg_policies p where p.schemaname = 'public'
                  and p.tablename = c.relname and p.policyname = 'block_customer_accounts');

-- ── PROOF AS A CUSTOMER (nothing is kept - rolls back) ──────────────────────
-- Run it as-is; it picks the newest customer account itself.
-- Expect: every staff table 0, shop tables still readable.
--
-- begin;
-- select set_config('request.jwt.claims', json_build_object('sub',
--   (select id::text from public.profiles where role = 'user' order by created_at desc limit 1),
--   'role', 'authenticated')::text, true);
-- set local role authenticated;
-- select (select count(*) from public.vendors)             as vendors,
--        (select count(*) from public.purchase_orders)     as purchase_orders,
--        (select count(*) from public.ff_vendor_payments)  as vendor_payments,
--        (select count(*) from public.invoices)            as invoices,
--        (select count(*) from public.inventory)           as stock,
--        (select count(*) from public.products)            as products_still_visible,
--        (select count(*) from public.hubs)                as hubs_still_visible;
-- rollback;

-- ── KILL SWITCH — undo this whole file ──────────────────────────────────────
-- begin;
-- do $$ declare r record; begin
--   for r in select schemaname, tablename from pg_policies where policyname = 'block_customer_accounts' loop
--     execute format('drop policy block_customer_accounts on %I.%I', r.schemaname, r.tablename);
--   end loop; end $$;
-- commit;
