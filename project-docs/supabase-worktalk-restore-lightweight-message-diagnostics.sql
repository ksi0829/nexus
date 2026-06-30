-- WorkTalk restore lightweight send-message diagnostics
-- Run in the Supabase SQL Editor for the WorkLog/NEXUS project.
--
-- Purpose:
--   Revert the heavy DB stall snapshots added in
--   supabase-worktalk-db-stall-diagnostics*.sql from the hot message-send path.
--
-- What this keeps:
--   - message_insert_ms
--   - notification_trigger_total_ms
--   - notification_insert_only_ms
--   - diagnostics_insert_ms
--   - after_total_to_return_ms
--   - function_entered_at / message_inserted_at / rpc_return_ready_at
--   - stage_marks JSON
--
-- What this removes from worktalk_send_message():
--   - worktalk_diag_activity_snapshot() calls
--   - pg_stat_activity reads
--   - pg_locks reads
--   - pg_blocking_pids() calls
--   - per-stage activity_snapshots / WAL LSN collection
--
-- Note:
--   Existing activity_snapshots / wal_lsn_* columns may remain on the diagnostics
--   table for historical rows and panel compatibility. New rows will not populate
--   them from the hot path.

alter table public.worktalk_send_message_diagnostics
  add column if not exists activity_snapshots jsonb not null default '{}'::jsonb,
  add column if not exists wal_lsn_start text,
  add column if not exists wal_lsn_after_message_insert text,
  add column if not exists wal_lsn_return_ready text,
  add column if not exists wal_bytes_message_insert numeric,
  add column if not exists wal_bytes_total numeric;

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
  notification_trigger_started_at timestamptz := null;
  notification_trigger_finished_at timestamptz := null;
  message_insert_core_estimated_ms integer := null;
  room_update_ms integer := null;
  sender_read_update_ms integer := null;
  return_prepare_ms integer := null;
  v_diagnostics_insert_ms integer := null;
  v_after_total_to_return_ms integer := null;
  total_ms integer := null;
  function_entered_at timestamptz := rpc_started_at;
  message_inserted_at timestamptz := null;
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
  perform set_config('worktalk.last_notification_trigger_started_at', '', true);
  perform set_config('worktalk.last_notification_trigger_finished_at', '', true);

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
  message_inserted_at := clock_timestamp();

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

  notification_trigger_started_at := nullif(
    current_setting('worktalk.last_notification_trigger_started_at', true),
    ''
  )::timestamptz;

  notification_trigger_finished_at := nullif(
    current_setting('worktalk.last_notification_trigger_finished_at', true),
    ''
  )::timestamptz;

  message_insert_core_estimated_ms := case
    when notification_trigger_total_ms is null then null
    else greatest(0, message_insert_ms - notification_trigger_total_ms)
  end;

  v_stage_marks := v_stage_marks || jsonb_build_object(
    'message_insert_done', clock_timestamp(),
    'message_inserted_at', message_inserted_at,
    'message_insert_ms', message_insert_ms,
    'message_insert_core_estimated_ms', message_insert_core_estimated_ms,
    'notification_trigger_started_at', notification_trigger_started_at,
    'notification_trigger_finished_at', notification_trigger_finished_at,
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
    message_inserted_at,
    notification_trigger_started_at,
    notification_trigger_finished_at,
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
    message_inserted_at,
    notification_trigger_started_at,
    notification_trigger_finished_at,
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

drop function if exists public.worktalk_diag_activity_snapshot(text);

-- Optional cleanup only if you want to remove heavy diagnostic columns later.
-- Keep them for now so the deployed debug panel can still query historical rows.
--
-- alter table public.worktalk_send_message_diagnostics
--   drop column if exists activity_snapshots,
--   drop column if exists wal_lsn_start,
--   drop column if exists wal_lsn_after_message_insert,
--   drop column if exists wal_lsn_return_ready,
--   drop column if exists wal_bytes_message_insert,
--   drop column if exists wal_bytes_total;
