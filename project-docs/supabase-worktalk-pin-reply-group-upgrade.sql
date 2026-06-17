begin;

alter table public.worktalk_messages
  add column if not exists reply_to_message_id bigint
    references public.worktalk_messages(id) on delete set null;

create index if not exists idx_worktalk_messages_reply_to
  on public.worktalk_messages(reply_to_message_id)
  where reply_to_message_id is not null;

create table if not exists public.worktalk_room_notices (
  room_id bigint primary key references public.worktalk_rooms(id) on delete cascade,
  message_id bigint not null references public.worktalk_messages(id) on delete cascade,
  pinned_by uuid references public.profiles(id) on delete set null,
  pinned_at timestamptz not null default now()
);

create index if not exists idx_worktalk_room_notices_message
  on public.worktalk_room_notices(message_id);

alter table public.worktalk_room_notices enable row level security;

grant select, insert, update, delete on public.worktalk_room_notices to authenticated;

drop policy if exists "worktalk_room_notices_select_member" on public.worktalk_room_notices;
create policy "worktalk_room_notices_select_member"
on public.worktalk_room_notices
for select
to authenticated
using (
  exists (
    select 1
    from public.worktalk_room_members member
    where member.room_id = worktalk_room_notices.room_id
      and member.user_id = auth.uid()
      and member.left_at is null
  )
  or public.worktalk_is_privileged()
);

drop policy if exists "worktalk_room_notices_write_member" on public.worktalk_room_notices;
create policy "worktalk_room_notices_write_member"
on public.worktalk_room_notices
for all
to authenticated
using (
  exists (
    select 1
    from public.worktalk_room_members member
    join public.worktalk_rooms room on room.id = member.room_id
    where member.room_id = worktalk_room_notices.room_id
      and member.user_id = auth.uid()
      and member.left_at is null
      and room.room_type = 'group'
      and room.is_fixed = false
  )
  or public.worktalk_is_privileged()
)
with check (
  exists (
    select 1
    from public.worktalk_room_members member
    join public.worktalk_rooms room on room.id = member.room_id
    where member.room_id = worktalk_room_notices.room_id
      and member.user_id = auth.uid()
      and member.left_at is null
      and room.room_type = 'group'
      and room.is_fixed = false
  )
  or public.worktalk_is_privileged()
);

create or replace function public.worktalk_set_room_notice(
  target_room_id bigint,
  target_message_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_row public.worktalk_rooms%rowtype;
begin
  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null
    or room_row.room_type <> 'group'
    or room_row.is_fixed = true then
    raise exception 'Only non-fixed group rooms support notices.';
  end if;

  if not exists (
    select 1
    from public.worktalk_room_members member
    where member.room_id = target_room_id
      and member.user_id = auth.uid()
      and member.left_at is null
  ) and not public.worktalk_is_privileged() then
    raise exception 'Only room members may pin notices.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_message_id
      and message.room_id = target_room_id
      and message.message_type <> 'system'
  ) then
    raise exception 'Notice message was not found.';
  end if;

  insert into public.worktalk_room_notices (
    room_id, message_id, pinned_by, pinned_at
  )
  values (
    target_room_id, target_message_id, auth.uid(), now()
  )
  on conflict (room_id)
  do update set
    message_id = excluded.message_id,
    pinned_by = excluded.pinned_by,
    pinned_at = excluded.pinned_at;
end;
$function$;

create or replace function public.worktalk_clear_room_notice(
  target_room_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (
    select 1
    from public.worktalk_room_members member
    join public.worktalk_rooms room on room.id = member.room_id
    where member.room_id = target_room_id
      and member.user_id = auth.uid()
      and member.left_at is null
      and room.room_type = 'group'
      and room.is_fixed = false
  ) and not public.worktalk_is_privileged() then
    raise exception 'Only room members may clear notices.';
  end if;

  delete from public.worktalk_room_notices
  where room_id = target_room_id;
end;
$function$;

create or replace function public.worktalk_send_reply_message(
  target_room_id bigint,
  message_body text,
  target_reply_to_message_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  profile_row public.profiles%rowtype;
  room_row public.worktalk_rooms%rowtype;
  new_message_id bigint;
begin
  if not public.worktalk_is_room_member(target_room_id) then
    raise exception 'Only room members may send messages.';
  end if;

  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null or room_row.room_type <> 'group' then
    raise exception 'Replies are currently supported only in group rooms.';
  end if;

  if nullif(btrim(message_body), '') is null then
    raise exception 'Message body is required.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_reply_to_message_id
      and message.room_id = target_room_id
  ) then
    raise exception 'Original message was not found.';
  end if;

  select * into profile_row from public.profiles where id = auth.uid();

  insert into public.worktalk_messages (
    room_id,
    sender_id,
    sender_name,
    sender_team,
    body,
    reply_to_message_id
  )
  values (
    target_room_id,
    auth.uid(),
    coalesce(profile_row.name, ''),
    profile_row.team,
    btrim(message_body),
    target_reply_to_message_id
  )
  returning id into new_message_id;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = target_room_id;

  update public.worktalk_room_members
  set last_read_message_id = new_message_id, last_read_at = now()
  where room_id = target_room_id and user_id = auth.uid();

  return new_message_id;
end;
$function$;

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
  next_title text;
begin
  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null
    or room_row.room_type not in ('group', 'direct')
    or room_row.is_fixed = true then
    raise exception 'Only non-fixed direct or group rooms support invitations.';
  end if;

  if not exists (
    select 1
    from public.worktalk_room_members member
    where member.room_id = target_room_id
      and member.user_id = auth.uid()
      and member.left_at is null
  ) and not public.worktalk_is_privileged() then
    raise exception 'Only room members may invite members.';
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

  if room_row.room_type = 'direct' then
    select string_agg(coalesce(profile.name, '사용자'), ', ' order by profile.name)
    into next_title
    from public.worktalk_room_members member
    left join public.profiles profile on profile.id = member.user_id
    where member.room_id = target_room_id
      and member.left_at is null;

    update public.worktalk_rooms
    set
      room_type = 'group',
      title = coalesce(nullif(next_title, ''), '그룹채팅'),
      updated_at = now()
    where id = target_room_id;
  end if;

  if nullif(invited_names, '') is not null then
    insert into public.worktalk_messages (
      room_id, sender_id, sender_name, message_type, body, metadata
    )
    values (
      target_room_id, null, 'NEXUS', 'system',
      invited_names || '님이 초대되었습니다.',
      jsonb_build_object('event', 'members_invited')
    );

    update public.worktalk_rooms
    set last_message_at = now(), updated_at = now()
    where id = target_room_id;
  end if;
end;
$function$;

grant execute on function public.worktalk_set_room_notice(bigint, bigint) to authenticated;
grant execute on function public.worktalk_clear_room_notice(bigint) to authenticated;
grant execute on function public.worktalk_send_reply_message(bigint, text, bigint) to authenticated;
grant execute on function public.worktalk_invite_group_members(bigint, uuid[]) to authenticated;

commit;
