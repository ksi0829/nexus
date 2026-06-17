-- ZETA field-test cleanup
-- Preserve:
--   auth.users, public.profiles
--   public.customers, public.customer_contacts, public.customer_equipments
-- Delete:
--   approval documents, worklogs, schedules, notices, A/S work orders,
--   sales records, production dashboard orders, and activity logs.

begin;

create or replace function public.zeta_delete_if_exists(target_table text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass(target_table) is not null then
    execute format('delete from %s', target_table);
  end if;
end;
$$;

-- Approval documents and related rows.
select public.zeta_delete_if_exists('public.approval_notifications');
select public.zeta_delete_if_exists('public.approval_references');
select public.zeta_delete_if_exists('public.approval_lines');

-- Production dashboard rows reference approval documents in some stages,
-- so remove production rows before removing approval document headers.
select public.zeta_delete_if_exists('public.equipment_orders');
select public.zeta_delete_if_exists('public.approval_documents');

-- A/S test data. Customer equipment master data is preserved.
select public.zeta_delete_if_exists('public.as_service_logs');
select public.zeta_delete_if_exists('public.as_work_orders');

-- Sales test data.
select public.zeta_delete_if_exists('public.sales_activities');
select public.zeta_delete_if_exists('public.sales_opportunities');

-- Worklog and schedule test data.
select public.zeta_delete_if_exists('public.worklog_items');
select public.zeta_delete_if_exists('public.worklogs');
select public.zeta_delete_if_exists('public.schedules');

-- Notice and activity-log test data.
select public.zeta_delete_if_exists('public.notices');
select public.zeta_delete_if_exists('public.user_activity_logs');

drop function if exists public.zeta_delete_if_exists(text);

commit;
