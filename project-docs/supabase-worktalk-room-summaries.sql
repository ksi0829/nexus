begin;

create or replace function public.worktalk_get_room_summaries()
returns table (
  id bigint,
  room_type text,
  title text,
  team_key text,
  created_by uuid,
  is_fixed boolean,
  is_archived boolean,
  last_message_at timestamptz,
  created_at timestamptz,
  members jsonb,
  latest_message jsonb,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    room.id,
    room.room_type,
    room.title,
    room.team_key,
    room.created_by,
    room.is_fixed,
    room.is_archived,
    room.last_message_at,
    room.created_at,
    coalesce(member_summary.members, '[]'::jsonb) as members,
    latest.message as latest_message,
    coalesce(unread.unread_count, 0)::bigint as unread_count
  from public.worktalk_rooms room
  left join public.worktalk_room_members own_member
    on own_member.room_id = room.id
   and own_member.user_id = auth.uid()
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'room_id', member.room_id,
        'user_id', member.user_id,
        'member_role', member.member_role,
        'notifications_enabled', member.notifications_enabled,
        'is_pinned', member.is_pinned,
        'sort_order', member.sort_order,
        'joined_at', member.joined_at,
        'left_at', member.left_at,
        'last_read_message_id', member.last_read_message_id,
        'last_read_at', member.last_read_at,
        'profile', jsonb_build_object(
          'id', profile.id,
          'name', coalesce(profile.name, ''),
          'team', coalesce(profile.team, ''),
          'role', coalesce(profile.role, '')
        )
      )
      order by
        case member.member_role when 'owner' then 0 when 'member' then 1 else 2 end,
        member.joined_at,
        member.user_id
    ) as members
    from public.worktalk_room_members member
    left join public.profiles profile
      on profile.id = member.user_id
    where member.room_id = room.id
      and (
        member.left_at is null
        or room.room_type = 'direct'
      )
  ) member_summary on true
  left join lateral (
    select jsonb_build_object(
      'id', message.id,
      'room_id', message.room_id,
      'sender_id', message.sender_id,
      'sender_name', message.sender_name,
      'sender_team', message.sender_team,
      'message_type', message.message_type,
      'body', message.body,
      'metadata', message.metadata,
      'created_at', message.created_at
    ) as message
    from public.worktalk_messages message
    where message.room_id = room.id
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  left join lateral (
    select count(message.id)::bigint as unread_count
    from public.worktalk_messages message
    where own_member.user_id = auth.uid()
      and own_member.left_at is null
      and message.room_id = room.id
      and message.created_at >= own_member.joined_at
      and message.sender_id is distinct from auth.uid()
      and (
        own_member.last_read_message_id is null
        or message.id > own_member.last_read_message_id
      )
  ) unread on true
  where room.is_archived = false
    and own_member.user_id = auth.uid()
    and (
      room.room_type = 'direct'
      or own_member.left_at is null
    )
  order by
    coalesce(own_member.is_pinned, false) desc,
    coalesce(own_member.sort_order, 0) asc,
    room.last_message_at desc,
    room.id desc;
$function$;

grant execute on function public.worktalk_get_room_summaries()
to authenticated;

commit;
