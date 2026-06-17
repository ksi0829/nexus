-- ZETA admin login diagnose
-- Run in Supabase SQL Editor and check the result rows.
-- It does not modify data.

select
  'auth_user' as section,
  u.id::text as id,
  u.email,
  u.aud,
  u.role,
  u.email_confirmed_at is not null as email_confirmed,
  crypt('12341234', u.encrypted_password) = u.encrypted_password as password_matches,
  u.created_at::text as created_at,
  u.updated_at::text as updated_at
from auth.users u
where u.email in ('admin@zetacorporation.com', 'ksi@zetacorporation.com')

union all

select
  'identity' as section,
  i.id::text as id,
  u.email,
  null as aud,
  i.provider as role,
  true as email_confirmed,
  (i.identity_data->>'email') = u.email as password_matches,
  i.created_at::text as created_at,
  i.updated_at::text as updated_at
from auth.identities i
join auth.users u on u.id = i.user_id
where u.email in ('admin@zetacorporation.com', 'ksi@zetacorporation.com')

union all

select
  'profile' as section,
  p.id::text as id,
  u.email,
  null as aud,
  p.role,
  true as email_confirmed,
  p.team = '관리자' as password_matches,
  null as created_at,
  null as updated_at
from public.profiles p
join auth.users u on u.id = p.id
where u.email in ('admin@zetacorporation.com', 'ksi@zetacorporation.com')
order by email, section;
