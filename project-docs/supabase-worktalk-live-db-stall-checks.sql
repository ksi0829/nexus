-- WorkTalk live DB stall checks
-- Run manually in a separate Supabase SQL Editor tab while reproducing slow sends.
--
-- This file does not change schema or functions. It is read-only diagnostics.

-- 1. Live wait events / background workers
select
  pid,
  usename,
  application_name,
  backend_type,
  state,
  wait_event_type,
  wait_event,
  now() - coalesce(xact_start, query_start) as active_for,
  left(query, 300) as query_preview
from pg_stat_activity
where wait_event is not null
   or query ilike '%worktalk_send_message%'
   or backend_type in ('autovacuum worker', 'checkpointer', 'walwriter', 'walsender')
order by active_for desc nulls last;

-- 2. Live blocking graph
select
  blocked.pid as blocked_pid,
  blocked_activity.wait_event_type as blocked_wait_type,
  blocked_activity.wait_event as blocked_wait,
  now() - blocked_activity.query_start as blocked_for,
  left(blocked_activity.query, 240) as blocked_query,
  blocking.pid as blocking_pid,
  blocking_activity.state as blocking_state,
  now() - blocking_activity.query_start as blocking_for,
  left(blocking_activity.query, 240) as blocking_query
from pg_locks blocked
join pg_stat_activity blocked_activity
  on blocked_activity.pid = blocked.pid
join pg_locks blocking
  on blocking.locktype = blocked.locktype
 and blocking.database is not distinct from blocked.database
 and blocking.relation is not distinct from blocked.relation
 and blocking.page is not distinct from blocked.page
 and blocking.tuple is not distinct from blocked.tuple
 and blocking.virtualxid is not distinct from blocked.virtualxid
 and blocking.transactionid is not distinct from blocked.transactionid
 and blocking.classid is not distinct from blocked.classid
 and blocking.objid is not distinct from blocked.objid
 and blocking.objsubid is not distinct from blocked.objsubid
 and blocking.pid <> blocked.pid
join pg_stat_activity blocking_activity
  on blocking_activity.pid = blocking.pid
where not blocked.granted
order by blocked_for desc;

-- 3. Autovacuum / table health snapshot
select
  relname,
  n_live_tup,
  n_dead_tup,
  vacuum_count,
  autovacuum_count,
  analyze_count,
  autoanalyze_count,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
  and relname in (
    'worktalk_messages',
    'worktalk_notifications',
    'worktalk_room_members',
    'worktalk_rooms',
    'profiles'
  )
order by relname;

-- 4. Checkpoint / background writer snapshot
-- Access can differ by Supabase plan.
select *
from pg_stat_bgwriter;

-- 5. WAL writer snapshot
-- Access can differ by Supabase plan.
select *
from pg_stat_wal;

-- 6. Replication / Realtime backlog snapshot
-- Access can differ by Supabase plan.
select
  slot_name,
  plugin,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) as confirmed_lag_bytes
from pg_replication_slots
order by slot_name;
