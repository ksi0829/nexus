begin;

drop policy if exists "chat_participants_insert_authenticated" on public.chat_participants;
drop policy if exists "chat_participants_delete_self" on public.chat_participants;
drop policy if exists "chat_threads_delete_creator" on public.chat_threads;

create or replace function public.is_chat_group_participant(target_thread_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $chat_group_access$
  select exists (
    select 1
    from public.chat_threads t
    join public.chat_participants p
      on p.thread_id = t.id
    where t.id = target_thread_id
      and t.thread_type = 'group'
      and p.user_id = auth.uid()
  );
$chat_group_access$;

grant execute on function public.is_chat_group_participant(bigint) to authenticated;

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
  or public.is_chat_group_participant(chat_participants.thread_id)
);

create policy "chat_participants_delete_self"
on public.chat_participants
for delete
to authenticated
using (user_id = auth.uid());

create policy "chat_threads_delete_creator"
on public.chat_threads
for delete
to authenticated
using (
  thread_type = 'group'
  and created_by = auth.uid()
);

commit;
