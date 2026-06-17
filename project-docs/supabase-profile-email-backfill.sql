begin;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is distinct from u.email;

commit;

select
  p.name,
  p.team,
  p.role,
  p.email
from public.profiles p
order by
  case p.team
    when '대표이사' then 1
    when '고문' then 2
    when '연구개발' then 3
    when '기술 1팀' then 4
    when '기술 2팀' then 5
    when '기술 3팀' then 6
    when '구매기획총무' then 7
    when '재무_인사' then 8
    when '국내영업' then 9
    when '해외영업' then 10
    when '관리자' then 99
    else 98
  end,
  p.role desc,
  p.name;
