begin;

-- Personal calendar: existing manual and approved-vacation schedules stay in place,
-- but a signed-in user can access only rows stored under their profile name.
alter table public.schedules enable row level security;

drop policy if exists "schedules_select_authenticated_all" on public.schedules;
drop policy if exists "schedules_select_own_writer" on public.schedules;

create policy "schedules_select_own_writer"
on public.schedules
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.name = schedules.writer
  )
);

drop policy if exists "schedules_insert_own_writer" on public.schedules;
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

drop policy if exists "schedules_update_own_writer" on public.schedules;
drop policy if exists "schedules_delete_own_writer" on public.schedules;
drop policy if exists "schedules_update_writer_or_admin" on public.schedules;
drop policy if exists "schedules_delete_writer_or_admin" on public.schedules;

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
