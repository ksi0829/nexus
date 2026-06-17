begin;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$fn$;

-- Worklogs: everyone can read according to the app view, but only the writer or admin can modify.
drop policy if exists "worklogs_update_own" on public.worklogs;
drop policy if exists "worklogs_delete_own" on public.worklogs;
drop policy if exists "worklogs_update_owner_or_admin" on public.worklogs;
drop policy if exists "worklogs_delete_owner_or_admin" on public.worklogs;

create policy "worklogs_update_owner_or_admin"
on public.worklogs
for update
to authenticated
using (user_id = auth.uid() or public.is_current_admin())
with check (user_id = auth.uid() or public.is_current_admin());

create policy "worklogs_delete_owner_or_admin"
on public.worklogs
for delete
to authenticated
using (user_id = auth.uid() or public.is_current_admin());

drop policy if exists "worklog_items_update_own_worklog" on public.worklog_items;
drop policy if exists "worklog_items_delete_own_worklog" on public.worklog_items;
drop policy if exists "worklog_items_update_owner_or_admin" on public.worklog_items;
drop policy if exists "worklog_items_delete_owner_or_admin" on public.worklog_items;

create policy "worklog_items_update_owner_or_admin"
on public.worklog_items
for update
to authenticated
using (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and (w.user_id = auth.uid() or public.is_current_admin())
  )
)
with check (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and (w.user_id = auth.uid() or public.is_current_admin())
  )
);

create policy "worklog_items_delete_owner_or_admin"
on public.worklog_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and (w.user_id = auth.uid() or public.is_current_admin())
  )
);

-- Schedules: shared read, writer/admin write.
drop policy if exists "schedules_update_own_writer" on public.schedules;
drop policy if exists "schedules_delete_own_writer" on public.schedules;
drop policy if exists "schedules_update_writer_or_admin" on public.schedules;
drop policy if exists "schedules_delete_writer_or_admin" on public.schedules;

create policy "schedules_update_writer_or_admin"
on public.schedules
for update
to authenticated
using (
  public.is_current_admin()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
  )
)
with check (
  public.is_current_admin()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
  )
);

create policy "schedules_delete_writer_or_admin"
on public.schedules
for delete
to authenticated
using (
  public.is_current_admin()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
  )
);

-- Shared operational modules: insert is authenticated; update/delete belongs to creator or admin.
drop policy if exists "customers_update_authenticated_all" on public.customers;
drop policy if exists "customers_delete_authenticated_all" on public.customers;
drop policy if exists "customers_update_owner_or_admin" on public.customers;
drop policy if exists "customers_delete_owner_or_admin" on public.customers;

create policy "customers_update_owner_or_admin"
on public.customers
for update
to authenticated
using (created_by = auth.uid() or public.is_current_admin())
with check (created_by = auth.uid() or public.is_current_admin());

create policy "customers_delete_owner_or_admin"
on public.customers
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

drop policy if exists "customer_contacts_update_authenticated_all" on public.customer_contacts;
drop policy if exists "customer_contacts_delete_authenticated_all" on public.customer_contacts;
drop policy if exists "customer_contacts_update_owner_or_admin" on public.customer_contacts;
drop policy if exists "customer_contacts_delete_owner_or_admin" on public.customer_contacts;

create policy "customer_contacts_update_owner_or_admin"
on public.customer_contacts
for update
to authenticated
using (created_by = auth.uid() or public.is_current_admin())
with check (created_by = auth.uid() or public.is_current_admin());

create policy "customer_contacts_delete_owner_or_admin"
on public.customer_contacts
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

drop policy if exists "as_work_orders_update_authenticated_all" on public.as_work_orders;
drop policy if exists "as_work_orders_delete_authenticated_all" on public.as_work_orders;
drop policy if exists "as_work_orders_update_owner_or_admin" on public.as_work_orders;
drop policy if exists "as_work_orders_delete_owner_or_admin" on public.as_work_orders;

create policy "as_work_orders_update_owner_or_admin"
on public.as_work_orders
for update
to authenticated
using (created_by = auth.uid() or public.is_current_admin())
with check (created_by = auth.uid() or public.is_current_admin());

create policy "as_work_orders_delete_owner_or_admin"
on public.as_work_orders
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

drop policy if exists "as_service_logs_insert_authenticated_all" on public.as_service_logs;
drop policy if exists "as_service_logs_update_authenticated_all" on public.as_service_logs;
drop policy if exists "as_service_logs_delete_authenticated_all" on public.as_service_logs;
drop policy if exists "as_service_logs_insert_owner_or_admin" on public.as_service_logs;
drop policy if exists "as_service_logs_update_owner_or_admin" on public.as_service_logs;
drop policy if exists "as_service_logs_delete_owner_or_admin" on public.as_service_logs;

create policy "as_service_logs_insert_owner_or_admin"
on public.as_service_logs
for insert
to authenticated
with check (
  exists (
    select 1
    from public.as_work_orders w
    where w.id = as_service_logs.work_order_id
      and (w.created_by = auth.uid() or public.is_current_admin())
  )
);

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

drop policy if exists "sales_activities_insert_authenticated_all" on public.sales_activities;
drop policy if exists "sales_activities_update_authenticated_all" on public.sales_activities;
drop policy if exists "sales_activities_delete_authenticated_all" on public.sales_activities;
drop policy if exists "sales_activities_insert_owner_or_admin" on public.sales_activities;
drop policy if exists "sales_activities_update_owner_or_admin" on public.sales_activities;
drop policy if exists "sales_activities_delete_owner_or_admin" on public.sales_activities;

create policy "sales_activities_insert_owner_or_admin"
on public.sales_activities
for insert
to authenticated
with check (
  exists (
    select 1
    from public.sales_opportunities o
    where o.id = sales_activities.opportunity_id
      and (o.created_by = auth.uid() or public.is_current_admin())
  )
);

create policy "sales_activities_update_owner_or_admin"
on public.sales_activities
for update
to authenticated
using (created_by = auth.uid() or public.is_current_admin())
with check (created_by = auth.uid() or public.is_current_admin());

create policy "sales_activities_delete_owner_or_admin"
on public.sales_activities
for delete
to authenticated
using (created_by = auth.uid() or public.is_current_admin());

commit;
