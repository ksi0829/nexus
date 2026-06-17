-- ZETA admin account repair
-- Run in Supabase SQL Editor as postgres.
-- This removes only admin@zetacorporation.com if it was partially created,
-- then recreates it with a matching auth.users / auth.identities / public.profiles set.

begin;

create extension if not exists pgcrypto;

do $$
declare
  admin_email text := 'admin@zetacorporation.com';
  admin_password text := '12341234';
  admin_user_id uuid := gen_random_uuid();
  existing_admin_id uuid;
  ksi_email text := 'ksi@zetacorporation.com';
begin
  select id
  into existing_admin_id
  from auth.users
  where email = admin_email
  limit 1;

  if existing_admin_id is not null then
    delete from auth.identities
    where user_id = existing_admin_id
       or (provider = 'email' and provider_id in (admin_email, existing_admin_id::text));

    delete from public.profiles
    where id = existing_admin_id;

    delete from auth.users
    where id = existing_admin_id;
  end if;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    admin_user_id,
    'authenticated',
    'authenticated',
    admin_email,
    crypt(admin_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('email_verified', true),
    now(),
    now()
  );

  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    admin_user_id,
    admin_user_id,
    admin_user_id::text,
    jsonb_build_object(
      'sub', admin_user_id::text,
      'email', admin_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.profiles (
    id,
    name,
    team,
    role,
    must_change_password
  )
  values (
    admin_user_id,
    '관리자',
    '관리자',
    'admin',
    false
  )
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
    and u.email = ksi_email;
end $$;

commit;
