begin;

create table if not exists public.admin_dashboard_settings (
  id text primary key check (id = 'default'),
  attachment_warning_limit_mb integer not null default 1024
    check (attachment_warning_limit_mb between 100 and 10240),
  cleanup_candidate_days integer not null default 365
    check (cleanup_candidate_days between 30 and 3650),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.admin_dashboard_settings (
  id,
  attachment_warning_limit_mb,
  cleanup_candidate_days
)
values ('default', 1024, 365)
on conflict (id) do nothing;

create or replace function public.set_admin_dashboard_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $settings_audit$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$settings_audit$;

drop trigger if exists trg_admin_dashboard_settings_audit
on public.admin_dashboard_settings;

create trigger trg_admin_dashboard_settings_audit
before update on public.admin_dashboard_settings
for each row execute function public.set_admin_dashboard_settings_audit();

alter table public.admin_dashboard_settings enable row level security;

grant select, update on public.admin_dashboard_settings to authenticated;

drop policy if exists "admin_dashboard_settings_select_admin" on public.admin_dashboard_settings;
create policy "admin_dashboard_settings_select_admin"
on public.admin_dashboard_settings
for select
to authenticated
using (public.is_system_admin());

drop policy if exists "admin_dashboard_settings_update_admin" on public.admin_dashboard_settings;
create policy "admin_dashboard_settings_update_admin"
on public.admin_dashboard_settings
for update
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

commit;
