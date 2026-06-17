begin;

-- NEXUS WorkTalk 기본방 기준:
-- 1) 관리/영업-전임직원
-- 2) 생산-전임직원
-- 3) 개발-전임직원
-- 4) 아이디어 소통방
--
-- 과거 worktalk_sync_fixed_rooms()가 profiles.team 전체를 기준으로 만든
-- 개별 부서 고정방은 더 이상 사용하지 않는다.

create temp table nexus_allowed_fixed_rooms (
  room_type text not null,
  team_key text not null,
  title text not null,
  primary key (room_type, team_key)
) on commit drop;

insert into nexus_allowed_fixed_rooms (room_type, team_key, title)
values
  ('team', '__company_admin_sales__', '관리/영업-전임직원'),
  ('team', '__company_production__', '생산-전임직원'),
  ('team', '__company_development__', '개발-전임직원'),
  ('idea', '__all__', '아이디어 소통방');

create temp table nexus_unwanted_fixed_rooms as
select
  room.id,
  room.room_type,
  room.title,
  room.team_key,
  count(message.id) as message_count
from public.worktalk_rooms room
left join public.worktalk_messages message
  on message.room_id = room.id
where room.is_fixed = true
  and room.room_type in ('team', 'idea')
  and not exists (
    select 1
    from nexus_allowed_fixed_rooms allowed
    where allowed.room_type = room.room_type
      and allowed.team_key = room.team_key
  )
group by room.id, room.room_type, room.title, room.team_key;

-- 메시지가 없는 불필요 고정방은 완전 삭제한다.
delete from public.worktalk_rooms room
using nexus_unwanted_fixed_rooms unwanted
where room.id = unwanted.id
  and unwanted.message_count = 0;

-- 메시지가 있는 불필요 고정방은 기록 보호를 위해 숨김 처리한다.
update public.worktalk_rooms room
set
  is_archived = true,
  archived_at = coalesce(room.archived_at, now()),
  updated_at = now()
from nexus_unwanted_fixed_rooms unwanted
where room.id = unwanted.id
  and unwanted.message_count > 0;

-- 허용 기본방은 정확한 이름과 활성 상태로 유지한다.
insert into public.worktalk_rooms (
  room_type,
  title,
  team_key,
  is_fixed,
  is_archived,
  archived_at,
  created_by
)
select
  allowed.room_type,
  allowed.title,
  allowed.team_key,
  true,
  false,
  null,
  null
from nexus_allowed_fixed_rooms allowed
on conflict (room_type, team_key) where team_key is not null
do update set
  title = excluded.title,
  is_fixed = true,
  is_archived = false,
  archived_at = null,
  updated_at = now();

-- 전 임직원이 들어가야 하는 기본방 멤버십 복구.
insert into public.worktalk_room_members (
  room_id,
  user_id,
  member_role,
  joined_at,
  left_at
)
select
  room.id,
  profile.id,
  'member',
  now(),
  null
from public.worktalk_rooms room
cross join public.profiles profile
where room.is_fixed = true
  and room.team_key in (
    '__company_admin_sales__',
    '__company_production__',
    '__company_development__',
    '__all__'
  )
on conflict (room_id, user_id)
do update set
  member_role = excluded.member_role,
  left_at = null;

-- 앞으로 자동 동기화 함수가 부서별 방을 다시 만들지 않도록 재정의한다.
create or replace function public.worktalk_sync_fixed_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.worktalk_is_privileged() then
    raise exception 'Administrator or executive access required.';
  end if;

  insert into public.worktalk_rooms (
    room_type,
    title,
    team_key,
    is_fixed,
    is_archived,
    archived_at,
    created_by
  )
  values
    ('team', '관리/영업-전임직원', '__company_admin_sales__', true, false, null, auth.uid()),
    ('team', '생산-전임직원', '__company_production__', true, false, null, auth.uid()),
    ('team', '개발-전임직원', '__company_development__', true, false, null, auth.uid()),
    ('idea', '아이디어 소통방', '__all__', true, false, null, auth.uid())
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
    member_role,
    joined_at,
    left_at
  )
  select
    room.id,
    profile.id,
    'member',
    now(),
    null
  from public.worktalk_rooms room
  cross join public.profiles profile
  where room.is_fixed = true
    and room.team_key in (
      '__company_admin_sales__',
      '__company_production__',
      '__company_development__',
      '__all__'
    )
  on conflict (room_id, user_id)
  do update set
    member_role = excluded.member_role,
    left_at = null;
end;
$function$;

grant execute on function public.worktalk_sync_fixed_rooms() to authenticated;

-- 적용 결과 확인용 출력.
select
  '허용 기본방' as item,
  room.id,
  room.room_type,
  room.title,
  room.team_key,
  room.is_archived,
  count(member.user_id) filter (where member.left_at is null) as active_member_count
from public.worktalk_rooms room
left join public.worktalk_room_members member
  on member.room_id = room.id
where room.team_key in (
  '__company_admin_sales__',
  '__company_production__',
  '__company_development__',
  '__all__'
)
group by room.id, room.room_type, room.title, room.team_key, room.is_archived
order by room.room_type, room.title;

select
  '숨김 처리된 과거 부서방' as item,
  room.id,
  room.title,
  room.team_key,
  room.is_archived
from public.worktalk_rooms room
where room.is_fixed = true
  and room.room_type in ('team', 'idea')
  and room.is_archived = true
order by room.title;

commit;
