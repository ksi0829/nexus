begin;

delete from public.worktalk_push_subscriptions
where endpoint is null
   or p256dh is null
   or auth is null;

with ranked_subscriptions as (
  select
    id,
    row_number() over (
      partition by endpoint
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.worktalk_push_subscriptions
)
delete from public.worktalk_push_subscriptions subscription
using ranked_subscriptions ranked
where subscription.id = ranked.id
  and ranked.row_number > 1;

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
