begin;

with desired(name, team, role) as (
  values
  ('장동철', '기술 3팀', 'lead'),
  ('박상현', '기술 1팀', 'user'),
  ('김종혁', '기술 2팀', 'user'),
  ('양희원', '기술 3팀', 'user'),
  ('권영일', '기술 1팀', 'user'),
  ('이승준', '기술 2팀', 'lead'),
  ('김학', '기술 1팀', 'user'),
  ('김성종', '기술 3팀', 'user'),
  ('한차현', '기술 1팀', 'lead'),
  ('이양로', '해외영업', 'lead'),
  ('한재영', '기술 1팀', 'user')
)
update public.profiles p
set name = desired.name,
    team = desired.team,
    role = desired.role
from desired
where p.name = desired.name;

commit;
