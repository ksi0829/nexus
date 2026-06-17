-- ZETA worklog permission hardening
-- Run in Supabase SQL Editor.
--
-- Goal:
-- - authenticated users can read shared operational data used by current screens
-- - only the owner can insert/update/delete their own worklogs and schedules
-- - worklog_items write permissions follow the parent worklogs.user_id owner
--
-- Notes:
-- - This script drops existing policies on the four public tables below, then recreates
--   the app's intended policies. It does not touch auth.users.
-- - schedules currently has no user_id/writer_id column, so schedule ownership is
--   enforced by matching schedules.writer to profiles.name for auth.uid().

begin;

-- Make sure RLS is active.
alter table public.profiles enable row level security;
alter table public.worklogs enable row level security;
alter table public.worklog_items enable row level security;
alter table public.schedules enable row level security;

-- Drop all existing policies on the app tables so older broad policies cannot still allow writes.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'worklogs', 'worklog_items', 'schedules')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

-- Explicit drops make the script safe to rerun even if a previous run stopped midway.
drop policy if exists "profiles_select_authenticated_all" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

drop policy if exists "worklogs_select_authenticated_all" on public.worklogs;
drop policy if exists "worklogs_insert_own" on public.worklogs;
drop policy if exists "worklogs_update_own" on public.worklogs;
drop policy if exists "worklogs_delete_own" on public.worklogs;

drop policy if exists "worklog_items_select_authenticated_all" on public.worklog_items;
drop policy if exists "worklog_items_insert_own_worklog" on public.worklog_items;
drop policy if exists "worklog_items_update_own_worklog" on public.worklog_items;
drop policy if exists "worklog_items_delete_own_worklog" on public.worklog_items;

drop policy if exists "schedules_select_authenticated_all" on public.schedules;
drop policy if exists "schedules_insert_own_writer" on public.schedules;
drop policy if exists "schedules_update_own_writer" on public.schedules;
drop policy if exists "schedules_delete_own_writer" on public.schedules;

-- Base grants for authenticated app users. RLS policies below still decide row access.
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.worklogs to authenticated;
grant select, insert, update, delete on public.worklog_items to authenticated;
grant select, insert, update, delete on public.schedules to authenticated;

-- PROFILES
-- Current app needs profile list reads for team/user views.
create policy "profiles_select_authenticated_all"
on public.profiles
for select
to authenticated
using (true);

-- Current password-change flow updates the signed-in user's must_change_password flag.
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- WORKLOGS
-- Worklog view screens need to see who has written logs.
create policy "worklogs_select_authenticated_all"
on public.worklogs
for select
to authenticated
using (true);

create policy "worklogs_insert_own"
on public.worklogs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "worklogs_update_own"
on public.worklogs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "worklogs_delete_own"
on public.worklogs
for delete
to authenticated
using (user_id = auth.uid());

-- WORKLOG ITEMS
-- Everyone can read detailed logs, but writes follow parent worklog ownership.
create policy "worklog_items_select_authenticated_all"
on public.worklog_items
for select
to authenticated
using (true);

create policy "worklog_items_insert_own_worklog"
on public.worklog_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and w.user_id = auth.uid()
  )
);

create policy "worklog_items_update_own_worklog"
on public.worklog_items
for update
to authenticated
using (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and w.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and w.user_id = auth.uid()
  )
);

create policy "worklog_items_delete_own_worklog"
on public.worklog_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.worklogs w
    where w.id = worklog_items.worklog_id
      and w.user_id = auth.uid()
  )
);

-- SCHEDULES
-- Calendar is shared-read, own-write. Ownership currently follows writer name.
create policy "schedules_select_authenticated_all"
on public.schedules
for select
to authenticated
using (true);

create policy "schedules_insert_own_writer"
on public.schedules
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
      and coalesce(p.team, '') = coalesce(schedules.team, '')
  )
);

create policy "schedules_update_own_writer"
on public.schedules
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
      and coalesce(p.team, '') = coalesce(schedules.team, '')
  )
);

create policy "schedules_delete_own_writer"
on public.schedules
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
  )
);

commit;
