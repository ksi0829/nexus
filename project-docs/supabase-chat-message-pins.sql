begin;

create table if not exists public.chat_message_pins (
  thread_id bigint not null references public.chat_threads(id) on delete cascade,
  message_id bigint not null,
  pinned_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (thread_id, message_id),
  constraint chat_message_pins_message_fkey
    foreign key (message_id) references public.chat_messages(id) on delete cascade
);

create index if not exists idx_chat_message_pins_thread_pinned
on public.chat_message_pins (thread_id, pinned_at desc);

create or replace function public.is_chat_pin_viewer(target_thread_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $chat_pin_viewer$
  select exists (
    select 1
    from public.chat_participants p
    where p.thread_id = target_thread_id
      and p.user_id = auth.uid()
  );
$chat_pin_viewer$;

create or replace function public.can_manage_chat_pin(target_thread_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $chat_pin_manager$
  select exists (
    select 1
    from public.chat_threads t
    join public.chat_participants p on p.thread_id = t.id
    where t.id = target_thread_id
      and p.user_id = auth.uid()
      and (
        t.thread_type = 'direct'
        or (t.thread_type = 'group' and t.created_by = auth.uid())
      )
  );
$chat_pin_manager$;

create or replace function public.validate_chat_message_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $chat_pin_validate$
begin
  if not exists (
    select 1
    from public.chat_messages m
    where m.id = new.message_id
      and m.thread_id = new.thread_id
  ) then
    raise exception 'Message does not belong to the selected chat thread.';
  end if;

  new.pinned_by := auth.uid();
  new.pinned_at := now();
  return new;
end;
$chat_pin_validate$;

drop trigger if exists trg_validate_chat_message_pin on public.chat_message_pins;
create trigger trg_validate_chat_message_pin
before insert on public.chat_message_pins
for each row execute function public.validate_chat_message_pin();

alter table public.chat_message_pins enable row level security;

grant select, insert, delete on public.chat_message_pins to authenticated;
grant execute on function public.is_chat_pin_viewer(bigint) to authenticated;
grant execute on function public.can_manage_chat_pin(bigint) to authenticated;

drop policy if exists "chat_message_pins_select_participant" on public.chat_message_pins;
create policy "chat_message_pins_select_participant"
on public.chat_message_pins
for select
to authenticated
using (public.is_chat_pin_viewer(thread_id));

drop policy if exists "chat_message_pins_insert_manager" on public.chat_message_pins;
create policy "chat_message_pins_insert_manager"
on public.chat_message_pins
for insert
to authenticated
with check (
  pinned_by = auth.uid()
  and public.can_manage_chat_pin(thread_id)
);

drop policy if exists "chat_message_pins_delete_manager" on public.chat_message_pins;
create policy "chat_message_pins_delete_manager"
on public.chat_message_pins
for delete
to authenticated
using (public.can_manage_chat_pin(thread_id));

do $chat_pin_realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_message_pins'
  ) then
    alter publication supabase_realtime add table public.chat_message_pins;
  end if;
end
$chat_pin_realtime$;

commit;
