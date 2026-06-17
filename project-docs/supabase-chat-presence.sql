begin;

create table if not exists public.chat_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visible boolean not null default false,
  last_seen_at timestamptz not null default now()
);

alter table public.chat_presence enable row level security;

grant select, insert, update on public.chat_presence to authenticated;

drop policy if exists "chat_presence_select_authenticated" on public.chat_presence;
drop policy if exists "chat_presence_insert_own" on public.chat_presence;
drop policy if exists "chat_presence_update_own" on public.chat_presence;

create policy "chat_presence_select_authenticated"
on public.chat_presence
for select
to authenticated
using (true);

create policy "chat_presence_insert_own"
on public.chat_presence
for insert
to authenticated
with check (user_id = auth.uid());

create policy "chat_presence_update_own"
on public.chat_presence
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

commit;
