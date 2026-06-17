begin;

with retired_users as (
  select id, email
  from auth.users
  where email in (
    'charles@zetacorporation.com',
    'dskim@zetacorporation.com',
    'tykim@zetacorporation.com'
  )
)
delete from public.profiles
where id in (select id from retired_users);

with retired_users as (
  select id, email
  from auth.users
  where email in (
    'charles@zetacorporation.com',
    'dskim@zetacorporation.com',
    'tykim@zetacorporation.com'
  )
)
delete from auth.identities
where user_id in (select id from retired_users)
   or provider_id in (
     select email from retired_users
     union
     select id::text from retired_users
   );

with retired_users as (
  select id
  from auth.users
  where email in (
    'charles@zetacorporation.com',
    'dskim@zetacorporation.com',
    'tykim@zetacorporation.com'
  )
)
delete from auth.sessions
where user_id in (select id from retired_users);

with retired_users as (
  select id
  from auth.users
  where email in (
    'charles@zetacorporation.com',
    'dskim@zetacorporation.com',
    'tykim@zetacorporation.com'
  )
)
delete from auth.mfa_factors
where user_id in (select id from retired_users);

delete from auth.users
where email in (
  'charles@zetacorporation.com',
  'dskim@zetacorporation.com',
  'tykim@zetacorporation.com'
);

commit;
