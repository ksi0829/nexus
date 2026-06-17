begin;

alter table public.worktalk_room_members
  add column if not exists is_pinned boolean not null default false,
  add column if not exists sort_order integer not null default 0;

create index if not exists idx_worktalk_room_members_personal_order
  on public.worktalk_room_members (user_id, is_pinned desc, sort_order, room_id);

create or replace function public.worktalk_set_room_pinned(
  target_room_id bigint,
  pinned boolean
)
returns void
language sql
security definer
set search_path = public
as $function$
  update public.worktalk_room_members
  set is_pinned = pinned
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;
$function$;

create or replace function public.worktalk_set_room_order(
  ordered_room_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_id_value bigint;
  position_value integer := 0;
begin
  if ordered_room_ids is null then
    return;
  end if;

  foreach room_id_value in array ordered_room_ids
  loop
    update public.worktalk_room_members
    set sort_order = position_value
    where room_id = room_id_value
      and user_id = auth.uid()
      and left_at is null;

    position_value := position_value + 1;
  end loop;
end;
$function$;

grant execute on function public.worktalk_set_room_pinned(bigint, boolean)
to authenticated;

grant execute on function public.worktalk_set_room_order(bigint[])
to authenticated;

commit;
