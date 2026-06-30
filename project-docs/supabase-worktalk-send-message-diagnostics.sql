-- WorkTalk send-message RPC latency diagnostics
-- Run in the Supabase SQL Editor for the WorkLog/NEXUS project.
--
-- Purpose:
--   Diagnose intermittent 2-7s delays inside public.worktalk_send_message().
--   This keeps the same RPC signature/return value and adds lightweight timing
--   rows to public.worktalk_send_message_diagnostics.
--
-- Notes:
--   In PostgreSQL, an INSERT statement includes AFTER INSERT trigger execution
--   before the statement returns. Therefore message_insert_ms is the statement
--   duration including worktalk_create_message_notifications(). This script also
--   records notification_trigger_total_ms and message_insert_core_estimated_ms
--   so we can separate the trigger cost from the core message insert estimate.

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
  notification_trigger_total_ms integer,
  notification_recipient_select_ms integer,
  notification_insert_only_ms integer,
  notification_recipient_count integer,
  message_insert_core_estimated_ms integer,
  room_update_ms integer,
  sender_read_update_ms integer,
  return_prepare_ms integer,
  diagnostics_insert_ms integer,
  after_total_to_return_ms integer,
  function_entered_at timestamptz,
  rpc_return_ready_at timestamptz,
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

alter table public.worktalk_send_message_diagnostics
  add column if not exists notification_trigger_total_ms integer,
  add column if not exists notification_recipient_select_ms integer,
  add column if not exists notification_insert_only_ms integer,
  add column if not exists notification_recipient_count integer,
  add column if not exists message_insert_core_estimated_ms integer,
  add column if not exists diagnostics_insert_ms integer,
  add column if not exists after_total_to_return_ms integer,
  add column if not exists function_entered_at timestamptz,
  add column if not exists rpc_return_ready_at timestamptz;

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
  trigger_started_at timestamptz := clock_timestamp();
  stage_started_at timestamptz := trigger_started_at;
  recipient_rows jsonb := '[]'::jsonb;
  recipient_select_ms integer := 0;
  recipient_count integer := 0;
  insert_only_ms integer := 0;
  trigger_total_ms integer := 0;
  inserted_count integer := 0;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', member.user_id,
        'room_id', new.room_id,
        'message_id', new.id,
        'sender_id', new.sender_id,
        'sender_name', new.sender_name,
        'title',
          case
            when new.message_type = 'file' then new.sender_name || '님이 파일을 보냈습니다.'
            when new.message_type = 'system' then '대화방 안내'
            else new.sender_name || '님의 새 메시지'
          end,
        'body', left(new.body, 180),
        'notification_type',
          case
            when new.message_type = 'file' then 'file'
            when new.message_type = 'system' then 'system'
            when new.message_type = 'document' then 'document'
            else 'message'
          end
      )
    ),
    '[]'::jsonb
  )
  into recipient_rows
  from public.worktalk_room_members member
  where member.room_id = new.room_id
    and member.left_at is null
    and member.notifications_enabled = true
    and member.user_id is distinct from new.sender_id;

  recipient_select_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  recipient_count := jsonb_array_length(recipient_rows);

  stage_started_at := clock_timestamp();

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
    recipient.user_id,
    recipient.room_id,
    recipient.message_id,
    recipient.sender_id,
    recipient.sender_name,
    recipient.title,
    recipient.body,
    recipient.notification_type
  from jsonb_to_recordset(recipient_rows) as recipient(
    user_id uuid,
    room_id bigint,
    message_id bigint,
    sender_id uuid,
    sender_name text,
    title text,
    body text,
    notification_type text
  )
  on conflict (user_id, message_id) do nothing;

  get diagnostics inserted_count = row_count;
  insert_only_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  trigger_total_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - trigger_started_at)) * 1000)::integer
  );

  perform set_config(
    'worktalk.last_notification_trigger_total_ms',
    trigger_total_ms::text,
    true
  );

  perform set_config(
    'worktalk.last_notification_recipient_select_ms',
    recipient_select_ms::text,
    true
  );

  perform set_config(
    'worktalk.last_notification_insert_only_ms',
    insert_only_ms::text,
    true
  );

  perform set_config(
    'worktalk.last_notification_insert_ms',
    trigger_total_ms::text,
    true
  );

  perform set_config(
    'worktalk.last_notification_rows',
    inserted_count::text,
    true
  );

  perform set_config(
    'worktalk.last_notification_recipient_count',
    recipient_count::text,
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
  notification_trigger_total_ms integer := null;
  notification_recipient_select_ms integer := null;
  notification_insert_only_ms integer := null;
  notification_recipient_count integer := null;
  message_insert_core_estimated_ms integer := null;
  room_update_ms integer := null;
  sender_read_update_ms integer := null;
  return_prepare_ms integer := null;
  v_diagnostics_insert_ms integer := null;
  v_after_total_to_return_ms integer := null;
  total_ms integer := null;
  function_entered_at timestamptz := rpc_started_at;
  total_calculated_at timestamptz := null;
  diagnostics_insert_started_at timestamptz := null;
  v_rpc_return_ready_at timestamptz := null;
  diagnostics_row_id bigint := null;
  v_stage_marks jsonb := '{}'::jsonb;
begin
  perform set_config('worktalk.last_notification_insert_ms', '', true);
  perform set_config('worktalk.last_notification_rows', '', true);
  perform set_config('worktalk.last_notification_trigger_total_ms', '', true);
  perform set_config('worktalk.last_notification_recipient_select_ms', '', true);
  perform set_config('worktalk.last_notification_insert_only_ms', '', true);
  perform set_config('worktalk.last_notification_recipient_count', '', true);

  v_stage_marks := v_stage_marks || jsonb_build_object(
    'rpc_start', function_entered_at,
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
  v_stage_marks := v_stage_marks || jsonb_build_object(
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
  v_stage_marks := v_stage_marks || jsonb_build_object(
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

  notification_trigger_total_ms := nullif(
    current_setting('worktalk.last_notification_trigger_total_ms', true),
    ''
  )::integer;

  notification_recipient_select_ms := nullif(
    current_setting('worktalk.last_notification_recipient_select_ms', true),
    ''
  )::integer;

  notification_insert_only_ms := nullif(
    current_setting('worktalk.last_notification_insert_only_ms', true),
    ''
  )::integer;

  notification_rows := nullif(
    current_setting('worktalk.last_notification_rows', true),
    ''
  )::integer;

  notification_recipient_count := nullif(
    current_setting('worktalk.last_notification_recipient_count', true),
    ''
  )::integer;

  message_insert_core_estimated_ms := case
    when notification_trigger_total_ms is null then null
    else greatest(0, message_insert_ms - notification_trigger_total_ms)
  end;

  v_stage_marks := v_stage_marks || jsonb_build_object(
    'message_insert_done', clock_timestamp(),
    'message_insert_ms', message_insert_ms,
    'message_insert_core_estimated_ms', message_insert_core_estimated_ms,
    'notification_trigger_total_ms', notification_trigger_total_ms,
    'notification_recipient_select_ms', notification_recipient_select_ms,
    'notification_insert_only_ms', notification_insert_only_ms,
    'notification_recipient_count', notification_recipient_count,
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
  v_stage_marks := v_stage_marks || jsonb_build_object(
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
  v_stage_marks := v_stage_marks || jsonb_build_object(
    'sender_read_update_done', clock_timestamp(),
    'sender_read_update_ms', sender_read_update_ms
  );

  stage_started_at := clock_timestamp();
  total_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - rpc_started_at)) * 1000)::integer
  );
  total_calculated_at := clock_timestamp();
  v_stage_marks := v_stage_marks || jsonb_build_object(
    'total_calculated_at', total_calculated_at,
    'total_ms', total_ms
  );
  return_prepare_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );

  diagnostics_insert_started_at := clock_timestamp();
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
    notification_trigger_total_ms,
    notification_recipient_select_ms,
    notification_insert_only_ms,
    notification_recipient_count,
    message_insert_core_estimated_ms,
    room_update_ms,
    sender_read_update_ms,
    return_prepare_ms,
    diagnostics_insert_ms,
    after_total_to_return_ms,
    function_entered_at,
    rpc_return_ready_at,
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
    notification_trigger_total_ms,
    notification_recipient_select_ms,
    notification_insert_only_ms,
    notification_recipient_count,
    message_insert_core_estimated_ms,
    room_update_ms,
    sender_read_update_ms,
    return_prepare_ms,
    null,
    null,
    function_entered_at,
    null,
    v_stage_marks
  )
  returning id into diagnostics_row_id;

  v_diagnostics_insert_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - diagnostics_insert_started_at)) * 1000)::integer
  );
  v_rpc_return_ready_at := clock_timestamp();
  v_after_total_to_return_ms := greatest(
    0,
    round(extract(epoch from (v_rpc_return_ready_at - total_calculated_at)) * 1000)::integer
  );
  v_stage_marks := v_stage_marks || jsonb_build_object(
    'diagnostics_insert_done', clock_timestamp(),
    'diagnostics_insert_ms', v_diagnostics_insert_ms,
    'rpc_return_ready_at', v_rpc_return_ready_at,
    'after_total_to_return_ms', v_after_total_to_return_ms
  );

  update public.worktalk_send_message_diagnostics
  set
    diagnostics_insert_ms = v_diagnostics_insert_ms,
    after_total_to_return_ms = v_after_total_to_return_ms,
    rpc_return_ready_at = v_rpc_return_ready_at,
    stage_marks = v_stage_marks
  where id = diagnostics_row_id;

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
--   message_insert_core_estimated_ms,
--   notification_trigger_total_ms,
--   notification_recipient_select_ms,
--   notification_insert_only_ms,
--   notification_recipient_count,
--   notification_insert_ms,
--   notification_rows,
--   room_update_ms,
--   sender_read_update_ms,
--   return_prepare_ms,
--   diagnostics_insert_ms,
--   after_total_to_return_ms,
--   function_entered_at,
--   rpc_return_ready_at
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

-- Object inspection helpers:
--
-- Triggers on worktalk_messages:
--
-- select
--   trigger_schema,
--   trigger_name,
--   event_manipulation,
--   action_timing,
--   action_statement
-- from information_schema.triggers
-- where event_object_schema = 'public'
--   and event_object_table = 'worktalk_messages'
-- order by trigger_name;
--
-- RLS policies:
--
-- select schemaname, tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'worktalk_messages',
--     'worktalk_notifications',
--     'worktalk_room_members',
--     'worktalk_rooms'
--   )
-- order by tablename, policyname;
--
-- Indexes:
--
-- select schemaname, tablename, indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in (
--     'worktalk_messages',
--     'worktalk_notifications',
--     'worktalk_room_members',
--     'worktalk_rooms'
--   )
-- order by tablename, indexname;
--
-- Constraints:
--
-- select
--   conrelid::regclass as table_name,
--   conname,
--   contype,
--   pg_get_constraintdef(oid) as constraint_def
-- from pg_constraint
-- where conrelid in (
--   'public.worktalk_messages'::regclass,
--   'public.worktalk_notifications'::regclass,
--   'public.worktalk_room_members'::regclass,
--   'public.worktalk_rooms'::regclass
-- )
-- order by table_name::text, conname;
--
-- Current lock waits involving WorkTalk tables:
--
-- select
--   blocked.pid as blocked_pid,
--   blocked_activity.usename as blocked_user,
--   blocked_activity.query as blocked_query,
--   blocking.pid as blocking_pid,
--   blocking_activity.usename as blocking_user,
--   blocking_activity.query as blocking_query,
--   now() - blocked_activity.query_start as blocked_duration
-- from pg_locks blocked
-- join pg_stat_activity blocked_activity
--   on blocked_activity.pid = blocked.pid
-- join pg_locks blocking
--   on blocking.locktype = blocked.locktype
--  and blocking.database is not distinct from blocked.database
--  and blocking.relation is not distinct from blocked.relation
--  and blocking.page is not distinct from blocked.page
--  and blocking.tuple is not distinct from blocked.tuple
--  and blocking.virtualxid is not distinct from blocked.virtualxid
--  and blocking.transactionid is not distinct from blocked.transactionid
--  and blocking.classid is not distinct from blocked.classid
--  and blocking.objid is not distinct from blocked.objid
--  and blocking.objsubid is not distinct from blocked.objsubid
--  and blocking.pid <> blocked.pid
-- join pg_stat_activity blocking_activity
--   on blocking_activity.pid = blocking.pid
-- where not blocked.granted
--   and blocked.relation in (
--     'public.worktalk_messages'::regclass,
--     'public.worktalk_notifications'::regclass,
--     'public.worktalk_room_members'::regclass,
--     'public.worktalk_rooms'::regclass
--   );
--
-- EXPLAIN helpers:
-- Replace ROOM_ID and USER_ID before running.
--
-- explain analyze
-- select 1
-- from public.worktalk_room_members member
-- where member.room_id = ROOM_ID
--   and member.user_id = 'USER_ID'::uuid
--   and member.left_at is null;
--
-- explain analyze
-- select
--   member.user_id
-- from public.worktalk_room_members member
-- where member.room_id = ROOM_ID
--   and member.left_at is null
--   and member.notifications_enabled = true
--   and member.user_id is distinct from 'USER_ID'::uuid;
