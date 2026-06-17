-- ZETA admin profile only
-- Run after creating admin@zetacorporation.com from Supabase Authentication > Users.

begin;

insert into public.profiles (
  id,
  name,
  team,
  role,
  must_change_password
)
select
  u.id,
  '관리자',
  '관리자',
  'admin',
  false
from auth.users u
where u.email = 'admin@zetacorporation.com'
on conflict (id) do update
set name = excluded.name,
    team = excluded.team,
    role = excluded.role,
    must_change_password = false;

update public.profiles p
set team = '국내영업',
    role = 'user'
from auth.users u
where p.id = u.id
  and u.email = 'ksi@zetacorporation.com';

commit;
