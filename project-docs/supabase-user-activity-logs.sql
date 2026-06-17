begin;

create table if not exists public.user_activity_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null default '',
  team text not null default '',
  role text not null default '',
  event_type text not null check (
    event_type in ('login', 'logout', 'activity', 'auto_logout')
  ),
  path text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.user_activity_logs enable row level security;

create index if not exists idx_user_activity_logs_user_time
on public.user_activity_logs (user_id, created_at desc);

create index if not exists idx_user_activity_logs_event_time
on public.user_activity_logs (event_type, created_at desc);

create or replace function public.is_system_admin()
returns boolean
language sql
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

create or replace function public.fill_user_activity_log_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row record;
begin
  select p.name, p.team, p.role
  into profile_row
  from public.profiles p
  where p.id = new.user_id;

  new.user_name := coalesce(profile_row.name, new.user_name, '');
  new.team := coalesce(profile_row.team, new.team, '');
  new.role := coalesce(profile_row.role, new.role, '');

  return new;
end;
$$;

drop trigger if exists trg_fill_user_activity_log_profile
on public.user_activity_logs;

create trigger trg_fill_user_activity_log_profile
before insert on public.user_activity_logs
for each row
execute function public.fill_user_activity_log_profile();

grant select, insert, delete on public.user_activity_logs to authenticated;
grant usage, select on sequence public.user_activity_logs_id_seq to authenticated;

drop policy if exists "user_activity_logs_insert_own" on public.user_activity_logs;
drop policy if exists "user_activity_logs_select_admin_or_own" on public.user_activity_logs;
drop policy if exists "user_activity_logs_select_authenticated_all" on public.user_activity_logs;
drop policy if exists "user_activity_logs_delete_admin" on public.user_activity_logs;

create policy "user_activity_logs_insert_own"
on public.user_activity_logs
for insert
to authenticated
with check (user_id = auth.uid());

create policy "user_activity_logs_select_authenticated_all"
on public.user_activity_logs
for select
to authenticated
using (true);

create policy "user_activity_logs_delete_admin"
on public.user_activity_logs
for delete
to authenticated
using (public.is_system_admin());

commit;
