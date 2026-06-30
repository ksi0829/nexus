-- WorkTalk DB stall diagnostics
-- Run in the Supabase SQL Editor for the WorkLog/NEXUS project.
--
-- Purpose:
--   Capture DB-side stall clues for intermittent 2-5s pauses where
--   worktalk_send_message() is usually fast but occasionally stalls.
--
-- What this can capture:
--   - current backend wait_event / wait_event_type snapshots before/after stages
--   - blocking pids visible at snapshot time
--   - lock counts held by the current backend
--   - WAL LSN deltas across the function
--
-- Important limitation:
--   A PL/pgSQL function cannot sample itself while it is blocked inside a SQL
--   statement. If the backend waits during INSERT/UPDATE, the next snapshot is
--   taken after the wait has ended. Use the live lock/wait queries at the bottom
--   while reproducing a slow send to catch the exact wait_event.

alter table public.worktalk_send_message_diagnostics
  add column if not exists activity_snapshots jsonb not null default '{}'::jsonb,
  add column if not exists wal_lsn_start text,
  add column if not exists wal_lsn_after_message_insert text,
  add column if not exists wal_lsn_return_ready text,
  add column if not exists wal_bytes_message_insert numeric,
  add column if not exists wal_bytes_total numeric;

create or replace function public.worktalk_diag_activity_snapshot(p_stage text)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $function$
  select jsonb_build_object(
    'stage', p_stage,
    'captured_at', clock_timestamp(),
    'pid', pg_backend_pid(),
    'txid', txid_current(),
    'wal_lsn', pg_current_wal_lsn()::text,
    'blocking_pids', to_jsonb(pg_blocking_pids(pg_backend_pid())),
    'lock_total', (
      select count(*)
      from pg_locks lock_row
      where lock_row.pid = pg_backend_pid()
    ),
    'lock_not_granted', (
      select count(*)
      from pg_locks lock_row
      where lock_row.pid = pg_backend_pid()
        and not lock_row.granted
    ),
    'state', activity.state,
    'wait_event_type', activity.wait_event_type,
    'wait_event', activity.wait_event,
    'backend_type', activity.backend_type,
    'backend_xid', activity.backend_xid::text,
    'backend_xmin', activity.backend_xmin::text,
    'xact_age_ms',
      case
        when activity.xact_start is null then null
        else round(extract(epoch from (clock_timestamp() - activity.xact_start)) * 1000)::integer
      end,
    'query_age_ms',
      case
        when activity.query_start is null then null
        else round(extract(epoch from (clock_timestamp() - activity.query_start)) * 1000)::integer
      end
  )
  from pg_stat_activity activity
  where activity.pid = pg_backend_pid();
$function$;

grant execute on function public.worktalk_diag_activity_snapshot(text) to authenticated;

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
  v_activity_snapshots jsonb := '{}'::jsonb;
  wal_lsn_start pg_lsn := pg_current_wal_lsn();
  wal_lsn_after_message_insert pg_lsn := null;
  wal_lsn_return_ready pg_lsn := null;
begin
  perform set_config('worktalk.last_notification_insert_ms', '', true);
  perform set_config('worktalk.last_notification_rows', '', true);
  perform set_config('worktalk.last_notification_trigger_total_ms', '', true);
  perform set_config('worktalk.last_notification_recipient_select_ms', '', true);
  perform set_config('worktalk.last_notification_insert_only_ms', '', true);
  perform set_config('worktalk.last_notification_recipient_count', '', true);
  perform set_config('worktalk.last_notification_trigger_started_at', '', true);
  perform set_config('worktalk.last_notification_trigger_finished_at', '', true);

  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'function_entered',
    public.worktalk_diag_activity_snapshot('function_entered')
  );

  v_stage_marks := v_stage_marks || jsonb_build_object(
    'rpc_start', function_entered_at,
    'target_room_id', target_room_id,
    'wal_lsn_start', wal_lsn_start::text
  );

  stage_started_at := clock_timestamp();
  if not public.worktalk_is_room_member(target_room_id) then
    raise exception 'Only room members may send messages.';
  end if;
  membership_check_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'after_membership_check',
    public.worktalk_diag_activity_snapshot('after_membership_check')
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
  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'after_profile_select',
    public.worktalk_diag_activity_snapshot('after_profile_select')
  );
  v_stage_marks := v_stage_marks || jsonb_build_object(
    'profile_select_done', clock_timestamp(),
    'profile_select_ms', profile_select_ms
  );

  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'before_message_insert',
    public.worktalk_diag_activity_snapshot('before_message_insert')
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
  wal_lsn_after_message_insert := pg_current_wal_lsn();
  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'after_message_insert',
    public.worktalk_diag_activity_snapshot('after_message_insert')
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
    'notification_rows', notification_rows,
    'wal_lsn_after_message_insert', wal_lsn_after_message_insert::text,
    'wal_bytes_message_insert',
      pg_wal_lsn_diff(wal_lsn_after_message_insert, wal_lsn_start)
  );

  stage_started_at := clock_timestamp();
  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = target_room_id;
  room_update_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'after_room_update',
    public.worktalk_diag_activity_snapshot('after_room_update')
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
  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'after_sender_read_update',
    public.worktalk_diag_activity_snapshot('after_sender_read_update')
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

  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'before_diagnostics_insert',
    public.worktalk_diag_activity_snapshot('before_diagnostics_insert')
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
    stage_marks,
    activity_snapshots,
    wal_lsn_start,
    wal_lsn_after_message_insert,
    wal_lsn_return_ready,
    wal_bytes_message_insert,
    wal_bytes_total
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
    v_stage_marks,
    v_activity_snapshots,
    wal_lsn_start::text,
    wal_lsn_after_message_insert::text,
    null,
    pg_wal_lsn_diff(wal_lsn_after_message_insert, wal_lsn_start),
    null
  )
  returning id into diagnostics_row_id;

  v_diagnostics_insert_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - diagnostics_insert_started_at)) * 1000)::integer
  );
  v_rpc_return_ready_at := clock_timestamp();
  wal_lsn_return_ready := pg_current_wal_lsn();
  v_after_total_to_return_ms := greatest(
    0,
    round(extract(epoch from (v_rpc_return_ready_at - total_calculated_at)) * 1000)::integer
  );
  v_activity_snapshots := v_activity_snapshots || jsonb_build_object(
    'return_ready',
    public.worktalk_diag_activity_snapshot('return_ready')
  );
  v_stage_marks := v_stage_marks || jsonb_build_object(
    'diagnostics_insert_done', clock_timestamp(),
    'diagnostics_insert_ms', v_diagnostics_insert_ms,
    'rpc_return_ready_at', v_rpc_return_ready_at,
    'after_total_to_return_ms', v_after_total_to_return_ms,
    'wal_lsn_return_ready', wal_lsn_return_ready::text,
    'wal_bytes_total', pg_wal_lsn_diff(wal_lsn_return_ready, wal_lsn_start)
  );

  update public.worktalk_send_message_diagnostics
  set
    diagnostics_insert_ms = v_diagnostics_insert_ms,
    after_total_to_return_ms = v_after_total_to_return_ms,
    rpc_return_ready_at = v_rpc_return_ready_at,
    stage_marks = v_stage_marks,
    activity_snapshots = v_activity_snapshots,
    wal_lsn_return_ready = wal_lsn_return_ready::text,
    wal_bytes_total = pg_wal_lsn_diff(wal_lsn_return_ready, wal_lsn_start)
  where id = diagnostics_row_id;

  return new_message_id;
end;
$function$;

grant execute on function public.worktalk_send_message(bigint, text) to authenticated;

-- Recent rows with wait / WAL snapshots:
--
-- select
--   created_at,
--   message_id,
--   body_preview,
--   total_ms,
--   message_insert_ms,
--   notification_trigger_total_ms,
--   room_update_ms,
--   sender_read_update_ms,
--   diagnostics_insert_ms,
--   wal_bytes_message_insert,
--   wal_bytes_total,
--   activity_snapshots #>> '{after_message_insert,wait_event_type}' as after_insert_wait_type,
--   activity_snapshots #>> '{after_message_insert,wait_event}' as after_insert_wait,
--   activity_snapshots #> '{after_message_insert,blocking_pids}' as after_insert_blocking_pids,
--   activity_snapshots #>> '{return_ready,wait_event_type}' as return_wait_type,
--   activity_snapshots #>> '{return_ready,wait_event}' as return_wait
-- from public.worktalk_send_message_diagnostics
-- order by created_at desc
-- limit 50;
--
-- Live wait events. Run this in another SQL Editor tab while reproducing slow sends:
--
-- select
--   pid,
--   usename,
--   application_name,
--   backend_type,
--   state,
--   wait_event_type,
--   wait_event,
--   now() - coalesce(xact_start, query_start) as active_for,
--   left(query, 300) as query_preview
-- from pg_stat_activity
-- where wait_event is not null
--    or query ilike '%worktalk_send_message%'
--    or backend_type in ('autovacuum worker', 'checkpointer', 'walwriter', 'walsender')
-- order by active_for desc nulls last;
--
-- Live blocking graph:
--
-- select
--   blocked.pid as blocked_pid,
--   blocked_activity.wait_event_type as blocked_wait_type,
--   blocked_activity.wait_event as blocked_wait,
--   now() - blocked_activity.query_start as blocked_for,
--   left(blocked_activity.query, 240) as blocked_query,
--   blocking.pid as blocking_pid,
--   blocking_activity.state as blocking_state,
--   now() - blocking_activity.query_start as blocking_for,
--   left(blocking_activity.query, 240) as blocking_query
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
-- order by blocked_for desc;
--
-- Autovacuum / table health snapshot:
--
-- select
--   relname,
--   n_live_tup,
--   n_dead_tup,
--   vacuum_count,
--   autovacuum_count,
--   analyze_count,
--   autoanalyze_count,
--   last_vacuum,
--   last_autovacuum,
--   last_analyze,
--   last_autoanalyze
-- from pg_stat_user_tables
-- where schemaname = 'public'
--   and relname in (
--     'worktalk_messages',
--     'worktalk_notifications',
--     'worktalk_room_members',
--     'worktalk_rooms',
--     'profiles'
--   )
-- order by relname;
--
-- Checkpoint / background writer snapshot. Access can differ by Supabase plan:
--
-- select *
-- from pg_stat_bgwriter;
--
-- WAL writer / WAL sync snapshot. Access can differ by Supabase plan:
--
-- select *
-- from pg_stat_wal;
--
-- Database-level transaction counters:
--
-- select
--   datname,
--   xact_commit,
--   xact_rollback,
--   blks_read,
--   blks_hit,
--   tup_inserted,
--   tup_updated,
--   deadlocks,
--   temp_files,
--   temp_bytes
-- from pg_stat_database
-- where datname = current_database();
--
-- Replication / Realtime backlog snapshot. Access can differ by Supabase plan:
--
-- select
--   slot_name,
--   plugin,
--   slot_type,
--   active,
--   restart_lsn,
--   confirmed_flush_lsn,
--   pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) as confirmed_lag_bytes
-- from pg_replication_slots
-- order by slot_name;
