begin;

create table if not exists public.chat_threads (
  id bigserial primary key,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_participants (
  thread_id bigint not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  team text,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (thread_id, user_id)
);

create table if not exists public.chat_messages (
  id bigserial primary key,
  thread_id bigint not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null,
  sender_team text,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.chat_threads enable row level security;
alter table public.chat_participants enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_threads_select_participant" on public.chat_threads;
drop policy if exists "chat_threads_insert_authenticated" on public.chat_threads;
drop policy if exists "chat_participants_select_participant" on public.chat_participants;
drop policy if exists "chat_participants_insert_authenticated" on public.chat_participants;
drop policy if exists "chat_participants_update_own" on public.chat_participants;
drop policy if exists "chat_messages_select_participant" on public.chat_messages;
drop policy if exists "chat_messages_insert_participant" on public.chat_messages;

create policy "chat_threads_select_participant"
on public.chat_threads
for select
to authenticated
using (
  created_by = auth.uid()
  or
  exists (
    select 1
    from public.chat_participants p
    where p.thread_id = chat_threads.id
      and p.user_id = auth.uid()
  )
);

create policy "chat_threads_insert_authenticated"
on public.chat_threads
for insert
to authenticated
with check (created_by = auth.uid());

create policy "chat_participants_select_participant"
on public.chat_participants
for select
to authenticated
using (true);

create policy "chat_participants_insert_authenticated"
on public.chat_participants
for insert
to authenticated
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.chat_threads t
    where t.id = chat_participants.thread_id
      and t.created_by = auth.uid()
  )
);

create policy "chat_participants_update_own"
on public.chat_participants
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "chat_messages_select_participant"
on public.chat_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.chat_participants p
    where p.thread_id = chat_messages.thread_id
      and p.user_id = auth.uid()
  )
);

create policy "chat_messages_insert_participant"
on public.chat_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.chat_participants p
    where p.thread_id = chat_messages.thread_id
      and p.user_id = auth.uid()
  )
);

create index if not exists idx_chat_participants_user_id
on public.chat_participants (user_id, thread_id);

create index if not exists idx_chat_messages_thread_created
on public.chat_messages (thread_id, created_at desc);

commit;
