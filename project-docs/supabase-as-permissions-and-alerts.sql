-- ZETA A/S permission and contact update
-- Run in Supabase SQL Editor after the shared modules SQL.

begin;

alter table public.as_work_orders
add column if not exists contact_name text not null default '',
add column if not exists contact_phone text not null default '';

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.is_tech1_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.team = '기술 1팀'
        or p.name in ('한차현', '한재영', '권영일', '김학', '박상현')
      )
  );
$$;

create or replace function public.can_create_as_work_order()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role in ('admin', 'lead', 'executive')
        or p.team in ('국내영업', '해외영업')
        or p.name in ('서중석', '한차현', '이승준', '장동철', '권현진', '김혜정', '정대용', '이양로')
      )
  );
$$;

drop policy if exists "as_work_orders_insert_authenticated_all" on public.as_work_orders;
drop policy if exists "as_work_orders_insert_authorized" on public.as_work_orders;
drop policy if exists "as_work_orders_update_authenticated_all" on public.as_work_orders;
drop policy if exists "as_work_orders_update_owner_or_admin" on public.as_work_orders;
drop policy if exists "as_work_orders_update_owner_admin_or_tech1" on public.as_work_orders;
drop policy if exists "as_work_orders_delete_authenticated_all" on public.as_work_orders;
drop policy if exists "as_work_orders_delete_owner_or_admin" on public.as_work_orders;

create policy "as_work_orders_insert_authorized"
on public.as_work_orders
for insert
to authenticated
with check (public.can_create_as_work_order());

create policy "as_work_orders_update_owner_admin_or_tech1"
on public.as_work_orders
for update
to authenticated
using (
  created_by = auth.uid()
  or public.is_current_admin()
  or public.is_tech1_member()
)
with check (
  created_by = auth.uid()
  or public.is_current_admin()
  or public.is_tech1_member()
);

create policy "as_work_orders_delete_owner_or_admin"
on public.as_work_orders
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

drop policy if exists "as_service_logs_insert_authenticated_all" on public.as_service_logs;
drop policy if exists "as_service_logs_insert_owner_or_admin" on public.as_service_logs;
drop policy if exists "as_service_logs_insert_tech1_or_owner_admin" on public.as_service_logs;
drop policy if exists "as_service_logs_update_authenticated_all" on public.as_service_logs;
drop policy if exists "as_service_logs_update_owner_or_admin" on public.as_service_logs;
drop policy if exists "as_service_logs_delete_authenticated_all" on public.as_service_logs;
drop policy if exists "as_service_logs_delete_owner_or_admin" on public.as_service_logs;

create policy "as_service_logs_insert_tech1_or_owner_admin"
on public.as_service_logs
for insert
to authenticated
with check (public.is_tech1_member() or public.is_current_admin());

create policy "as_service_logs_update_owner_or_admin"
on public.as_service_logs
for update
to authenticated
using (created_by = auth.uid() or public.is_current_admin())
with check (created_by = auth.uid() or public.is_current_admin());

create policy "as_service_logs_delete_owner_or_admin"
on public.as_service_logs
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

-- Re-assert sales ownership policies so creators can edit/delete their own sales records.
drop policy if exists "sales_opportunities_update_authenticated_all" on public.sales_opportunities;
drop policy if exists "sales_opportunities_delete_authenticated_all" on public.sales_opportunities;
drop policy if exists "sales_opportunities_update_owner_or_admin" on public.sales_opportunities;
drop policy if exists "sales_opportunities_delete_owner_or_admin" on public.sales_opportunities;

create policy "sales_opportunities_update_owner_or_admin"
on public.sales_opportunities
for update
to authenticated
using (created_by = auth.uid() or public.is_current_admin())
with check (created_by = auth.uid() or public.is_current_admin());

create policy "sales_opportunities_delete_owner_or_admin"
on public.sales_opportunities
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

commit;
