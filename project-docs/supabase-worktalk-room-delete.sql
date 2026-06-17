begin;

create or replace function public.worktalk_delete_group_room(
  target_room_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_row public.worktalk_rooms%rowtype;
begin
  select *
  into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null then
    raise exception 'WorkTalk room was not found.';
  end if;

  if room_row.room_type <> 'group'
    or room_row.is_fixed = true
    or room_row.created_by is distinct from auth.uid() then
    raise exception 'Only the owner may delete a non-fixed group room.';
  end if;

  delete from public.worktalk_rooms
  where id = target_room_id;
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
begin
  select *
  into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null then
    raise exception 'WorkTalk room was not found.';
  end if;

  if room_row.room_type <> 'group' or room_row.is_fixed = true then
    raise exception 'Only non-fixed group rooms may be left.';
  end if;

  if room_row.created_by = auth.uid() then
    raise exception 'The room owner must delete the room instead of leaving it.';
  end if;

  update public.worktalk_room_members
  set left_at = now()
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;
end;
$function$;

grant execute on function public.worktalk_delete_group_room(bigint)
to authenticated;

grant execute on function public.worktalk_leave_group_room(bigint)
to authenticated;

drop policy if exists "worktalk_storage_delete_room_owner"
on storage.objects;

create policy "worktalk_storage_delete_room_owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'worktalk-files'
  and public.worktalk_can_manage_room(
    ((storage.foldername(name))[1])::bigint
  )
);

commit;
