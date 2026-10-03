-- ============================================================================
-- ADD_WEBSITE_CUSTOMERS_LIST_2026-10-03.sql
-- A separate list for website / customer-portal sign-ups, so they stop mixing with staff.
--
-- Customers who sign in with a mobile OTP are created in auth.users (provider 'phone') and get a
-- bare profiles row with role 'user'. The browser cannot read auth.users, so this admin-only
-- function reads it for the new "Website Customers" page: name, phone, email, when they signed
-- up, last sign-in and how many orders they have placed (shop orders by their login, plus
-- sales orders matching their mobile number).
--
-- Allowed callers: admin, ceo, ff_operations_manager (checked inside the function).
-- Read-only; changes no table. Safe to run.
-- ============================================================================

begin;

create or replace function public.admin_website_customers()
returns table(
  id uuid, phone text, email text, name text,
  signed_up_at timestamptz, last_sign_in_at timestamptz, provider text,
  phone_verified boolean, email_verified boolean,
  shop_orders bigint, ff_orders bigint, last_order_at timestamptz)
language plpgsql stable security definer
set search_path = public, auth as $$
begin
  if lower(coalesce(public.get_my_role(), '')) not in ('admin', 'ceo', 'ff_operations_manager') then
    raise exception 'Only admin, CEO or FF operations manager can view website customers';
  end if;

  return query
  select u.id,
         u.phone::text,
         u.email::text,
         coalesce(
           nullif(btrim(p.name), ''),
           (select nullif(btrim(cp.name), '') from public.customer_profiles cp
             where u.phone is not null
               and right(regexp_replace(coalesce(cp.phone, ''), '\D', '', 'g'), 10)
                 = right(regexp_replace(u.phone, '\D', '', 'g'), 10) limit 1),
           (select nullif(btrim(c.name), '') from public.customers c
             where u.phone is not null
               and right(regexp_replace(coalesce(c.phone, c.mobile, ''), '\D', '', 'g'), 10)
                 = right(regexp_replace(u.phone, '\D', '', 'g'), 10) limit 1),
           nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '')),
         u.created_at,
         u.last_sign_in_at,
         coalesce(u.raw_app_meta_data ->> 'provider', '?'),
         u.phone_confirmed_at is not null,
         u.email_confirmed_at is not null,
         (select count(*) from public.orders o where o.user_id = u.id::text),
         (select count(*) from public.sales_orders so
           where u.phone is not null
             and right(regexp_replace(coalesce(so.customer_phone, ''), '\D', '', 'g'), 10)
               = right(regexp_replace(u.phone, '\D', '', 'g'), 10)),
         greatest(
           (select max(o.created_at) from public.orders o where o.user_id = u.id::text),
           (select max(so.created_at) from public.sales_orders so
             where u.phone is not null
               and right(regexp_replace(coalesce(so.customer_phone, ''), '\D', '', 'g'), 10)
                 = right(regexp_replace(u.phone, '\D', '', 'g'), 10)))
  from auth.users u
  left join public.profiles p on p.id = u.id
  -- a website customer = signed up by phone OTP with no staff profile, or a profile whose role is user/customer
  where (p.id is null and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'phone')
     or lower(coalesce(p.role, '')) in ('user', 'customer')
  order by u.created_at desc;
end $$;

revoke all on function public.admin_website_customers() from public, anon;
grant execute on function public.admin_website_customers() to authenticated, service_role;

commit;

-- VERIFY (read-only). The SQL editor has no signed-in user, so the role check would refuse a direct call;
-- this counts the same set directly instead. Expect about 10.
select count(*) as website_customers
from auth.users u left join public.profiles p on p.id = u.id
where (p.id is null and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'phone')
   or lower(coalesce(p.role, '')) in ('user', 'customer');
