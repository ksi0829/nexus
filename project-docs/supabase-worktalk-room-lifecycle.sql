begin;

alter table public.worktalk_rooms replica identity full;
alter table public.worktalk_room_members replica identity full;

create or replace function public.worktalk_invite_group_members(
  target_room_id bigint,
  member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_row public.worktalk_rooms%rowtype;
  invited_ids uuid[];
  invited_names text;
begin
  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null
    or room_row.room_type <> 'group'
    or room_row.is_fixed = true then
    raise exception 'Only non-fixed group rooms support invitations.';
  end if;

  if room_row.created_by is distinct from auth.uid()
    and not public.worktalk_is_privileged() then
    raise exception 'Only the room owner may invite members.';
  end if;

  if member_ids is null or cardinality(member_ids) < 1 then
    raise exception 'At least one member is required.';
  end if;

  select array_agg(profile.id), string_agg(profile.name, ', ' order by profile.name)
  into invited_ids, invited_names
  from public.profiles profile
  left join public.worktalk_room_members member
    on member.room_id = target_room_id
   and member.user_id = profile.id
  where profile.id = any(member_ids)
    and profile.id <> auth.uid()
    and (member.user_id is null or member.left_at is not null);

  if invited_ids is null or cardinality(invited_ids) < 1 then
    return;
  end if;

  insert into public.worktalk_room_members (
    room_id, user_id, member_role, joined_at, left_at
  )
  select target_room_id, profile.id, 'member', now(), null
  from public.profiles profile
  where profile.id = any(invited_ids)
  on conflict (room_id, user_id)
  do update set
    member_role = 'member',
    joined_at = now(),
    left_at = null;

  if nullif(invited_names, '') is not null then
    insert into public.worktalk_messages (
      room_id, sender_id, sender_name, message_type, body, metadata
    )
    values (
      target_room_id, null, 'WorkTalk', 'system',
      invited_names || '님이 초대되었습니다.',
      jsonb_build_object('event', 'members_invited')
    );

    update public.worktalk_rooms
    set last_message_at = now(), updated_at = now()
    where id = target_room_id;
  end if;
end;
$function$;

create or replace function public.worktalk_leave_group_room(
  target_room_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_row public.worktalk_rooms%rowtype;
  profile_name text;
begin
  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null then
    raise exception 'WorkTalk room was not found.';
  end if;

  if room_row.room_type <> 'group' or room_row.is_fixed = true then
    raise exception 'Only non-fixed group rooms may be left.';
  end if;

  if room_row.created_by = auth.uid() then
    raise exception 'Transfer room ownership before leaving.';
  end if;

  if not exists (
    select 1
    from public.worktalk_room_members member
    where member.room_id = target_room_id
      and member.user_id = auth.uid()
      and member.left_at is null
  ) then
    raise exception 'You are not an active member of this room.';
  end if;

  select coalesce(name, '사용자') into profile_name
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_messages (
    room_id, sender_id, sender_name, message_type, body, metadata
  )
  values (
    target_room_id, null, 'WorkTalk', 'system',
    profile_name || '님이 대화방을 나갔습니다.',
    jsonb_build_object('event', 'member_left', 'user_id', auth.uid())
  );

  update public.worktalk_room_members
  set left_at = now()
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = target_room_id;
end;
$function$;

create or replace function public.worktalk_transfer_owner_and_leave(
  target_room_id bigint,
  new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_row public.worktalk_rooms%rowtype;
  current_name text;
  new_owner_name text;
begin
  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null
    or room_row.room_type <> 'group'
    or room_row.is_fixed = true
    or room_row.created_by is distinct from auth.uid() then
    raise exception 'Only the owner of a non-fixed group room may transfer ownership.';
  end if;

  if new_owner_id is null or new_owner_id = auth.uid() then
    raise exception 'Select another active member as the new owner.';
  end if;

  if not exists (
    select 1
    from public.worktalk_room_members member
    where member.room_id = target_room_id
      and member.user_id = new_owner_id
      and member.left_at is null
  ) then
    raise exception 'The new owner must be an active room member.';
  end if;

  select coalesce(name, '사용자') into current_name
  from public.profiles where id = auth.uid();

  select coalesce(name, '사용자') into new_owner_name
  from public.profiles where id = new_owner_id;

  update public.worktalk_rooms
  set created_by = new_owner_id, updated_at = now()
  where id = target_room_id;

  update public.worktalk_room_members
  set member_role = case
    when user_id = new_owner_id then 'owner'
    else 'member'
  end
  where room_id = target_room_id
    and user_id in (auth.uid(), new_owner_id);

  insert into public.worktalk_messages (
    room_id, sender_id, sender_name, message_type, body, metadata
  )
  values (
    target_room_id, null, 'WorkTalk', 'system',
    current_name || '님이 ' || new_owner_name ||
      '님에게 방장 권한을 양도하고 대화방을 나갔습니다.',
    jsonb_build_object(
      'event', 'owner_transferred',
      'previous_owner_id', auth.uid(),
      'new_owner_id', new_owner_id
    )
  );

  update public.worktalk_room_members
  set left_at = now()
  where room_id = target_room_id
    and user_id = auth.uid();

  update public.worktalk_rooms
  set last_message_at = now()
  where id = target_room_id;
end;
$function$;

grant execute on function public.worktalk_invite_group_members(bigint, uuid[])
to authenticated;

grant execute on function public.worktalk_leave_group_room(bigint)
to authenticated;

grant execute on function public.worktalk_transfer_owner_and_leave(bigint, uuid)
to authenticated;

do $realtime$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'worktalk_rooms'
  ) then
    alter publication supabase_realtime add table public.worktalk_rooms;
  end if;
end
$realtime$;

commit;
