begin;

alter table public.worktalk_push_subscriptions
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists endpoint text,
  add column if not exists p256dh text,
  add column if not exists auth text,
  add column if not exists user_agent text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_worktalk_push_subscriptions_endpoint
  on public.worktalk_push_subscriptions (endpoint);

create index if not exists idx_worktalk_push_subscriptions_user
  on public.worktalk_push_subscriptions (user_id);

create or replace function public.worktalk_save_push_subscription(
  subscription_endpoint text,
  subscription_p256dh text,
  subscription_auth text,
  subscription_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  insert into public.worktalk_push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent
  )
  values (
    auth.uid(),
    subscription_endpoint,
    subscription_p256dh,
    subscription_auth,
    nullif(subscription_user_agent, '')
  )
  on conflict (endpoint) do update
  set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    updated_at = now();
end;
$function$;

grant execute on function public.worktalk_save_push_subscription(text, text, text, text)
to authenticated;

notify pgrst, 'reload schema';

commit;
