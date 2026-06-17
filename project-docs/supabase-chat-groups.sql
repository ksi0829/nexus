begin;

alter table public.chat_threads
  add column if not exists thread_type text not null default 'direct',
  add column if not exists title text;

drop policy if exists "chat_threads_update_participant" on public.chat_threads;

create policy "chat_threads_update_participant"
on public.chat_threads
for update
to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1
    from public.chat_participants p
    where p.thread_id = chat_threads.id
      and p.user_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
  or exists (
    select 1
    from public.chat_participants p
    where p.thread_id = chat_threads.id
      and p.user_id = auth.uid()
  )
);

create or replace function public.touch_chat_thread_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $chat_touch$
begin
  update public.chat_threads
  set updated_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$chat_touch$;

drop trigger if exists trg_chat_messages_touch_thread on public.chat_messages;
create trigger trg_chat_messages_touch_thread
after insert on public.chat_messages
for each row execute function public.touch_chat_thread_on_message();

create index if not exists idx_chat_threads_type_updated
on public.chat_threads (thread_type, updated_at desc);

commit;
