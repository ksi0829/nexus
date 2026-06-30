-- WorkTalk message body GIN index drop test
-- Run in the Supabase SQL Editor for the WorkLog/NEXUS project.
--
-- Purpose:
--   Test whether idx_worktalk_messages_body_search is causing intermittent
--   worktalk_messages INSERT spikes.
--
-- Background:
--   The app's current message search uses:
--     .ilike("body", "%keyword%")
--   not:
--     to_tsvector('simple', body) @@ ...
--
--   Therefore the existing GIN index on to_tsvector('simple', body) is unlikely
--   to be used by current app search, but it is maintained on every message
--   INSERT and can add intermittent GIN pending-list / maintenance cost.
--
-- Test plan:
--   1. Run the DROP INDEX block below.
--   2. Send 50 messages in the same test pattern.
--   3. Compare MESSAGE PERFORMANCE:
--      - Average
--      - Maximum
--      - >1s
--      - message_insert_ms
--      - notification_trigger_total_ms
--      - message.created_at -> commit
--      - commit -> payload
--   4. If search performance or results are unacceptable, run the restore block
--      at the bottom.
--
-- Important:
--   This is a performance experiment, not a final production decision.

-- Current index definition check:
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'worktalk_messages'
  and indexname = 'idx_worktalk_messages_body_search';

-- DROP test index.
drop index if exists public.idx_worktalk_messages_body_search;

-- Confirm it is gone.
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'worktalk_messages'
  and indexname = 'idx_worktalk_messages_body_search';

-- Optional: verify current app search query shape.
-- This mirrors the app path in hooks/useWorkTalk.ts:
--   .from("worktalk_messages")
--   .in("room_id", activeRoomIds)
--   .ilike("body", "%keyword%")
--
-- Replace ROOM_ID and KEYWORD before running.
--
-- explain analyze
-- select id, room_id, sender_name, body, created_at
-- from public.worktalk_messages
-- where room_id in (ROOM_ID)
--   and body ilike '%KEYWORD%'
-- order by created_at desc
-- limit 50;

-- Optional: recent diagnostics after the 50-message test.
-- This is read-only and helps compare the same fields shown in the admin panel.
--
-- select
--   created_at,
--   message_id,
--   body_preview,
--   total_ms,
--   message_insert_ms,
--   notification_trigger_total_ms,
--   notification_insert_only_ms,
--   message_insert_core_estimated_ms,
--   diagnostics_insert_ms,
--   after_total_to_return_ms,
--   message_inserted_at,
--   rpc_return_ready_at
-- from public.worktalk_send_message_diagnostics
-- order by created_at desc
-- limit 60;

-- Restore block.
-- Run this only if you decide to restore the full-text GIN index.
--
-- create index if not exists idx_worktalk_messages_body_search
--   on public.worktalk_messages using gin (to_tsvector('simple', body));
--
-- analyze public.worktalk_messages;
