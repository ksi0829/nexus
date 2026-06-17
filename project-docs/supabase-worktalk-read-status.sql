begin;

create or replace function public.worktalk_mark_room_read(
  target_room_id bigint,
  target_message_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  resolved_message_id bigint;
begin
  if not public.worktalk_is_room_member(target_room_id) then
    raise exception 'Only room members may mark messages as read.';
  end if;

  if target_message_id is null then
    select max(id) into resolved_message_id
    from public.worktalk_messages
    where room_id = target_room_id;
  else
    select id into resolved_message_id
    from public.worktalk_messages
    where room_id = target_room_id
      and id = target_message_id;
  end if;

  update public.worktalk_room_members
  set
    last_read_message_id = case
      when resolved_message_id is null then last_read_message_id
      when last_read_message_id is null then resolved_message_id
      else greatest(last_read_message_id, resolved_message_id)
    end,
    last_read_at = now()
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;
end;
$function$;

create or replace function public.worktalk_get_unread_counts()
returns table (
  room_id bigint,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    member.room_id,
    count(message.id)::bigint as unread_count
  from public.worktalk_room_members member
  left join public.worktalk_messages message
    on message.room_id = member.room_id
   and message.created_at >= member.joined_at
   and message.sender_id is distinct from auth.uid()
   and (
     member.last_read_message_id is null
     or message.id > member.last_read_message_id
   )
  where member.user_id = auth.uid()
    and member.left_at is null
  group by member.room_id;
$function$;

grant execute on function public.worktalk_mark_room_read(bigint, bigint)
to authenticated;

grant execute on function public.worktalk_get_unread_counts()
to authenticated;

commit;
