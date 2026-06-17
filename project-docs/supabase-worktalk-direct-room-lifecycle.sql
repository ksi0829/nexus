begin;

create or replace function public.worktalk_create_direct_room(target_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  existing_room_id bigint;
  new_room_id bigint;
  current_profile public.profiles%rowtype;
  target_profile public.profiles%rowtype;
begin
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'A different user is required.';
  end if;

  select * into current_profile from public.profiles where id = auth.uid();
  select * into target_profile from public.profiles where id = target_user_id;

  if current_profile.id is null or target_profile.id is null then
    raise exception 'Profile was not found.';
  end if;

  select room.id
  into existing_room_id
  from public.worktalk_rooms room
  where room.room_type = 'direct'
    and room.is_archived = false
    and (
      select count(*)
      from public.worktalk_room_members member
      where member.room_id = room.id
    ) = 2
    and exists (
      select 1
      from public.worktalk_room_members member
      where member.room_id = room.id
        and member.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.worktalk_room_members member
      where member.room_id = room.id
        and member.user_id = target_user_id
    )
  order by room.created_at desc
  limit 1;

  if existing_room_id is not null then
    update public.worktalk_room_members
    set joined_at = now(), left_at = null
    where room_id = existing_room_id
      and user_id = auth.uid();

    return existing_room_id;
  end if;

  insert into public.worktalk_rooms (room_type, title, created_by)
  values ('direct', '', auth.uid())
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values
    (new_room_id, auth.uid(), 'owner'),
    (new_room_id, target_user_id, 'member');

  return new_room_id;
end;
$function$;

create or replace function public.worktalk_leave_direct_room(
  target_room_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  active_member_count integer;
begin
  if not exists (
    select 1
    from public.worktalk_rooms room
    join public.worktalk_room_members member
      on member.room_id = room.id
    where room.id = target_room_id
      and room.room_type = 'direct'
      and room.is_fixed = false
      and member.user_id = auth.uid()
      and member.left_at is null
  ) then
    raise exception 'Only an active member may leave a direct room.';
  end if;

  update public.worktalk_room_members
  set left_at = now()
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;

  select count(*)
  into active_member_count
  from public.worktalk_room_members member
  where member.room_id = target_room_id
    and member.left_at is null;

  if active_member_count = 0 then
    delete from public.worktalk_rooms
    where id = target_room_id;
    return true;
  end if;

  return false;
end;
$function$;

grant execute on function public.worktalk_create_direct_room(uuid)
to authenticated;

grant execute on function public.worktalk_leave_direct_room(bigint)
to authenticated;

drop policy if exists "worktalk_storage_delete_direct_member"
on storage.objects;

create policy "worktalk_storage_delete_direct_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'worktalk-files'
  and exists (
    select 1
    from public.worktalk_rooms room
    join public.worktalk_room_members member
      on member.room_id = room.id
    where room.id = ((storage.foldername(name))[1])::bigint
      and room.room_type = 'direct'
      and member.user_id = auth.uid()
      and member.left_at is null
  )
);

commit;
