begin;

insert into public.worktalk_rooms (
  room_type,
  title,
  team_key,
  is_fixed,
  created_by
)
values
  ('team', '관리/영업-전임직원', '__company_admin_sales__', true, null),
  ('team', '생산-전임직원', '__company_production__', true, null),
  ('team', '개발-전임직원', '__company_development__', true, null)
on conflict (room_type, team_key) where team_key is not null
do update set
  title = excluded.title,
  is_fixed = true,
  is_archived = false,
  archived_at = null,
  updated_at = now();

insert into public.worktalk_room_members (
  room_id,
  user_id,
  member_role
)
select
  room.id,
  profile.id,
  'member'
from public.worktalk_rooms room
cross join public.profiles profile
where room.team_key in (
  '__company_admin_sales__',
  '__company_production__',
  '__company_development__'
)
on conflict (room_id, user_id)
do update set left_at = null;

commit;
