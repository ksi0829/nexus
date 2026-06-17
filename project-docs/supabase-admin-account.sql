-- ZETA admin account split
-- Run in Supabase SQL Editor as postgres.
-- Creates/updates admin@zetacorporation.com and demotes ksi@zetacorporation.com to a normal domestic sales user.

begin;

create extension if not exists pgcrypto;

do $$
declare
  admin_email text := 'admin@zetacorporation.com';
  admin_password text := '12341234';
  admin_user_id uuid;
  ksi_email text := 'ksi@zetacorporation.com';
begin
  select id
  into admin_user_id
  from auth.users
  where email = admin_email
  limit 1;

  if admin_user_id is null then
    admin_user_id := gen_random_uuid();

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
      '{}'::jsonb,
      now(),
      now()
    );
  else
    update auth.users
    set encrypted_password = crypt(admin_password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    where id = admin_user_id;
  end if;

  if to_regclass('auth.identities') is not null then
    delete from auth.identities
    where user_id = admin_user_id
       or (provider = 'email' and provider_id in (admin_email, admin_user_id::text));

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
  end if;

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
