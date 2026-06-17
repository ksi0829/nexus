-- ZETA production database read-only audit
-- Created: 2026-05-27
--
-- Safety:
-- - This file contains SELECT statements only.
-- - It does not insert, update, delete, alter, drop, grant, or create anything.
-- - Run it in Supabase SQL Editor to inspect the currently deployed database state.

-- 1. High-risk current-state checks.
with checks(check_name, passed, detail) as (
  select
    'chat_presence table exists',
    to_regclass('public.chat_presence') is not null,
    coalesce(to_regclass('public.chat_presence')::text, 'missing')

  union all

  select
    'schedules private SELECT policy exists',
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'schedules'
        and policyname = 'schedules_select_own_writer'
        and cmd = 'SELECT'
    ),
    'expected policy: schedules_select_own_writer'

  union all

  select
    'schedules shared SELECT policy is absent',
    not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'schedules'
        and policyname = 'schedules_select_authenticated_all'
    ),
    'obsolete policy must not exist: schedules_select_authenticated_all'

  union all

  select
    'schedules admin write policy is absent',
    not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'schedules'
        and policyname in ('schedules_update_writer_or_admin', 'schedules_delete_writer_or_admin')
    ),
    'private calendar removes prior writer/admin policies'

  union all

  select
    'chat_presence policies exist',
    (
      select count(*) = 3
      from pg_policies
      where schemaname = 'public'
        and tablename = 'chat_presence'
        and policyname in (
          'chat_presence_select_authenticated',
          'chat_presence_insert_own',
          'chat_presence_update_own'
        )
    ),
    'expected 3 chat_presence policies'

  union all

  select
    'chat realtime publication includes messages and participants',
    (
      select count(*) = 2
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename in ('chat_messages', 'chat_participants')
    ),
    'expected chat_messages and chat_participants in supabase_realtime'
)
select check_name, passed, detail
from checks
order by passed, check_name;

-- 2. Current RLS policies for recently changed or permission-sensitive tables.
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'schedules',
    'chat_threads',
    'chat_participants',
    'chat_messages',
    'chat_presence',
    'approval_documents',
    'approval_lines',
    'approval_references'
  )
order by tablename, cmd, policyname;

-- 3. Expected public tables used by currently implemented modules.
with expected_table(table_name) as (
  values
    ('profiles'),
    ('worklogs'),
    ('worklog_items'),
    ('schedules'),
    ('customers'),
    ('customer_contacts'),
    ('customer_equipments'),
    ('as_work_orders'),
    ('as_service_logs'),
    ('sales_opportunities'),
    ('sales_activities'),
    ('approval_documents'),
    ('approval_lines'),
    ('approval_references'),
    ('approval_notifications'),
    ('equipment_orders'),
    ('user_activity_logs'),
    ('chat_threads'),
    ('chat_participants'),
    ('chat_messages'),
    ('chat_presence')
)
select
  table_name,
  to_regclass('public.' || table_name) is not null as exists_in_public
from expected_table
order by table_name;

-- 4. Key server functions that current screens depend on.
with expected_function(function_name) as (
  values
    ('is_current_admin'),
    ('can_read_approval_document'),
    ('submit_approval_document'),
    ('add_vacation_schedule_from_document'),
    ('is_chat_group_participant'),
    ('touch_chat_thread_on_message')
)
select
  ef.function_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = ef.function_name
  ) as exists_in_public
from expected_function ef
order by ef.function_name;

-- 5. Exact deployed definition of the two policies changed most recently.
select
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'schedules' and policyname like 'schedules_%')
    or (tablename = 'chat_presence' and policyname like 'chat_presence_%')
  )
order by tablename, policyname;
