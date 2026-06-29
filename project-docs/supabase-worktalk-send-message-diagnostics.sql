-- WorkTalk send-message RPC latency diagnostics
-- Run in the Supabase SQL Editor for the WorkLog/NEXUS project.
--
-- Purpose:
--   Diagnose intermittent 2-7s delays inside public.worktalk_send_message().
--   This keeps the same RPC signature/return value and adds lightweight timing
--   rows to public.worktalk_send_message_diagnostics.

create table if not exists public.worktalk_send_message_diagnostics (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  room_id bigint,
  message_id bigint,
  sender_id uuid,
  body_preview text,
  total_ms integer,
  membership_check_ms integer,
  profile_select_ms integer,
  message_insert_ms integer,
  notification_insert_ms integer,
  notification_rows integer,
  room_update_ms integer,
  sender_read_update_ms integer,
  return_prepare_ms integer,
  stage_marks jsonb not null default '{}'::jsonb,
  txid bigint not null default txid_current(),
  backend_pid integer not null default pg_backend_pid()
);

create index if not exists idx_worktalk_send_message_diag_created
  on public.worktalk_send_message_diagnostics (created_at desc);

create index if not exists idx_worktalk_send_message_diag_message
  on public.worktalk_send_message_diagnostics (message_id);

create index if not exists idx_worktalk_send_message_diag_slow
  on public.worktalk_send_message_diagnostics (total_ms desc, created_at desc);

alter table public.worktalk_send_message_diagnostics enable row level security;

drop policy if exists "worktalk_send_message_diag_admin_select"
on public.worktalk_send_message_diagnostics;

create policy "worktalk_send_message_diag_admin_select"
on public.worktalk_send_message_diagnostics
for select
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'admin'
  )
);

grant select on public.worktalk_send_message_diagnostics to authenticated;

create or replace function public.worktalk_create_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  stage_started_at timestamptz := clock_timestamp();
  inserted_count integer := 0;
begin
  insert into public.worktalk_notifications (
    user_id,
    room_id,
    message_id,
    sender_id,
    sender_name,
    title,
    body,
    notification_type
  )
  select
    member.user_id,
    new.room_id,
    new.id,
    new.sender_id,
    new.sender_name,
    case
      when new.message_type = 'file' then new.sender_name || '님이 파일을 보냈습니다.'
      when new.message_type = 'system' then '대화방 안내'
      else new.sender_name || '님의 새 메시지'
    end,
    left(new.body, 180),
    case
      when new.message_type = 'file' then 'file'
      when new.message_type = 'system' then 'system'
      when new.message_type = 'document' then 'document'
      else 'message'
    end
  from public.worktalk_room_members member
  where member.room_id = new.room_id
    and member.left_at is null
    and member.notifications_enabled = true
    and member.user_id is distinct from new.sender_id
  on conflict (user_id, message_id) do nothing;

  get diagnostics inserted_count = row_count;

  perform set_config(
    'worktalk.last_notification_insert_ms',
    greatest(
      0,
      round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
    )::text,
    true
  );

  perform set_config(
    'worktalk.last_notification_rows',
    inserted_count::text,
    true
  );

  return new;
end;
$function$;

create or replace function public.worktalk_send_message(
  target_room_id bigint,
  message_body text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  profile_row public.profiles%rowtype;
  new_message_id bigint;
  rpc_started_at timestamptz := clock_timestamp();
  stage_started_at timestamptz := rpc_started_at;
  membership_check_ms integer := null;
  profile_select_ms integer := null;
  message_insert_ms integer := null;
  notification_insert_ms integer := null;
  notification_rows integer := null;
  room_update_ms integer := null;
  sender_read_update_ms integer := null;
  return_prepare_ms integer := null;
  total_ms integer := null;
  stage_marks jsonb := '{}'::jsonb;
begin
  perform set_config('worktalk.last_notification_insert_ms', '', true);
  perform set_config('worktalk.last_notification_rows', '', true);

  stage_marks := stage_marks || jsonb_build_object(
    'rpc_start', clock_timestamp(),
    'target_room_id', target_room_id
  );

  stage_started_at := clock_timestamp();
  if not public.worktalk_is_room_member(target_room_id) then
    raise exception 'Only room members may send messages.';
  end if;
  membership_check_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  stage_marks := stage_marks || jsonb_build_object(
    'membership_check_done', clock_timestamp(),
    'membership_check_ms', membership_check_ms
  );

  if nullif(btrim(message_body), '') is null then
    raise exception 'Message body is required.';
  end if;

  stage_started_at := clock_timestamp();
  select * into profile_row from public.profiles where id = auth.uid();
  profile_select_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  stage_marks := stage_marks || jsonb_build_object(
    'profile_select_done', clock_timestamp(),
    'profile_select_ms', profile_select_ms
  );

  stage_started_at := clock_timestamp();
  insert into public.worktalk_messages (
    room_id,
    sender_id,
    sender_name,
    sender_team,
    body
  )
  values (
    target_room_id,
    auth.uid(),
    coalesce(profile_row.name, ''),
    profile_row.team,
    btrim(message_body)
  )
  returning id into new_message_id;
  message_insert_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );

  notification_insert_ms := nullif(
    current_setting('worktalk.last_notification_insert_ms', true),
    ''
  )::integer;

  notification_rows := nullif(
    current_setting('worktalk.last_notification_rows', true),
    ''
  )::integer;

  stage_marks := stage_marks || jsonb_build_object(
    'message_insert_done', clock_timestamp(),
    'message_insert_ms', message_insert_ms,
    'notification_insert_ms', notification_insert_ms,
    'notification_rows', notification_rows
  );

  stage_started_at := clock_timestamp();
  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = target_room_id;
  room_update_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  stage_marks := stage_marks || jsonb_build_object(
    'room_update_done', clock_timestamp(),
    'room_update_ms', room_update_ms
  );

  stage_started_at := clock_timestamp();
  update public.worktalk_room_members
  set last_read_message_id = new_message_id, last_read_at = now()
  where room_id = target_room_id and user_id = auth.uid();
  sender_read_update_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  stage_marks := stage_marks || jsonb_build_object(
    'sender_read_update_done', clock_timestamp(),
    'sender_read_update_ms', sender_read_update_ms
  );

  stage_started_at := clock_timestamp();
  total_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - rpc_started_at)) * 1000)::integer
  );
  stage_marks := stage_marks || jsonb_build_object(
    'rpc_return_ready', clock_timestamp(),
    'total_ms', total_ms
  );
  return_prepare_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );

  insert into public.worktalk_send_message_diagnostics (
    room_id,
    message_id,
    sender_id,
    body_preview,
    total_ms,
    membership_check_ms,
    profile_select_ms,
    message_insert_ms,
    notification_insert_ms,
    notification_rows,
    room_update_ms,
    sender_read_update_ms,
    return_prepare_ms,
    stage_marks
  )
  values (
    target_room_id,
    new_message_id,
    auth.uid(),
    left(btrim(message_body), 80),
    total_ms,
    membership_check_ms,
    profile_select_ms,
    message_insert_ms,
    notification_insert_ms,
    notification_rows,
    room_update_ms,
    sender_read_update_ms,
    return_prepare_ms,
    stage_marks
  );

  return new_message_id;
end;
$function$;

grant execute on function public.worktalk_send_message(bigint, text) to authenticated;

-- Recent slow send-message RPCs:
--
-- select
--   created_at,
--   room_id,
--   message_id,
--   body_preview,
--   total_ms,
--   membership_check_ms,
--   profile_select_ms,
--   message_insert_ms,
--   notification_insert_ms,
--   notification_rows,
--   room_update_ms,
--   sender_read_update_ms,
--   return_prepare_ms
-- from public.worktalk_send_message_diagnostics
-- order by created_at desc
-- limit 50;
--
-- Slowest recent rows:
--
-- select *
-- from public.worktalk_send_message_diagnostics
-- where created_at > now() - interval '1 day'
-- order by total_ms desc
-- limit 20;
