-- ZETA admin auth cleanup
-- Run in Supabase SQL Editor before creating admin@zetacorporation.com from the Supabase Auth UI.
-- It deletes only the partially-created admin account records.

begin;

do $$
declare
  admin_email text := 'admin@zetacorporation.com';
  admin_user_id uuid;
begin
  select id
  into admin_user_id
  from auth.users
  where email = admin_email
  limit 1;

  if admin_user_id is not null then
    if to_regclass('auth.mfa_factors') is not null then
      execute 'delete from auth.mfa_factors where user_id = $1' using admin_user_id;
    end if;

    if to_regclass('auth.sessions') is not null then
      execute 'delete from auth.sessions where user_id = $1' using admin_user_id;
    end if;

    delete from auth.identities
    where user_id = admin_user_id
       or (provider = 'email' and provider_id in (admin_email, admin_user_id::text));

    delete from public.profiles
    where id = admin_user_id;

    delete from auth.users
    where id = admin_user_id;
  end if;
end $$;

commit;
