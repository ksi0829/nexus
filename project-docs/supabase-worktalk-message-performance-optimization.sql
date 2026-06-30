-- WorkTalk send-message DB transaction optimization
-- Run in the Supabase SQL Editor for the WorkLog/NEXUS project.
--
-- Goal:
--   Reduce pre-commit latency in public.worktalk_send_message() without changing
--   the client UX, Realtime path, Push path, or read-receipt behavior.
--
-- Scope:
--   1. Add lightweight indexes for active room-member / notification lookup.
--   2. Replace notification trigger internals with a lighter uuid[] recipient
--      flow instead of jsonb_agg -> jsonb_to_recordset.
--   3. Keep the existing diagnostics set_config values so the admin
--      MESSAGE PERFORMANCE panel continues to work.
--
-- Notes:
--   message_insert_ms includes AFTER INSERT trigger time. Lowering
--   notification_trigger_total_ms should directly lower message_insert_ms and
--   message.created_at -> commit.

create index if not exists idx_worktalk_room_members_room_active_notifications
  on public.worktalk_room_members (room_id, user_id)
  where left_at is null and notifications_enabled = true;

create index if not exists idx_worktalk_room_members_room_active
  on public.worktalk_room_members (room_id, user_id)
  where left_at is null;

create index if not exists idx_worktalk_notifications_room_user_unread_message
  on public.worktalk_notifications (room_id, user_id, read_at, message_id);

create index if not exists idx_worktalk_notifications_message
  on public.worktalk_notifications (message_id);

analyze public.worktalk_room_members;
analyze public.worktalk_notifications;
analyze public.worktalk_messages;

create or replace function public.worktalk_create_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  trigger_started_at timestamptz := clock_timestamp();
  stage_started_at timestamptz := trigger_started_at;
  recipient_ids uuid[] := '{}'::uuid[];
  recipient_select_ms integer := 0;
  recipient_count integer := 0;
  insert_only_ms integer := 0;
  trigger_total_ms integer := 0;
  inserted_count integer := 0;
  notification_title text := '';
  notification_type_value text := 'message';
begin
  perform set_config(
    'worktalk.last_notification_trigger_started_at',
    trigger_started_at::text,
    true
  );

  notification_title := case
    when new.message_type = 'file' then new.sender_name || '님이 파일을 보냈습니다.'
    when new.message_type = 'system' then '대화방 안내'
    else new.sender_name || '님의 새 메시지'
  end;

  notification_type_value := case
    when new.message_type = 'file' then 'file'
    when new.message_type = 'system' then 'system'
    when new.message_type = 'document' then 'document'
    else 'message'
  end;

  select coalesce(array_agg(member.user_id), '{}'::uuid[])
  into recipient_ids
  from public.worktalk_room_members member
  where member.room_id = new.room_id
    and member.left_at is null
    and member.notifications_enabled = true
    and member.user_id is distinct from new.sender_id;

  recipient_select_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  recipient_count := cardinality(recipient_ids);

  stage_started_at := clock_timestamp();

  if recipient_count > 0 then
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
      new.room_id,
      new.id,
      new.sender_id,
      new.sender_name,
      notification_title,
      left(new.body, 180),
      notification_type_value
    from unnest(recipient_ids) as recipient(user_id)
    on conflict (user_id, message_id) do nothing;

    get diagnostics inserted_count = row_count;
  else
    inserted_count := 0;
  end if;

  insert_only_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - stage_started_at)) * 1000)::integer
  );
  trigger_total_ms := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - trigger_started_at)) * 1000)::integer
  );

  perform set_config(
    'worktalk.last_notification_trigger_finished_at',
    clock_timestamp()::text,
    true
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

-- Optional verification helpers after test messages:
--
-- select
--   message_id,
--   body_preview,
--   total_ms,
--   message_insert_ms,
--   message_insert_core_estimated_ms,
--   notification_trigger_total_ms,
--   notification_recipient_select_ms,
--   notification_insert_only_ms,
--   notification_recipient_count,
--   diagnostics_insert_ms,
--   after_total_to_return_ms,
--   stage_marks
-- from public.worktalk_send_message_diagnostics
-- order by created_at desc
-- limit 30;
--
-- explain analyze
-- select member.user_id
-- from public.worktalk_room_members member
-- where member.room_id = ROOM_ID
--   and member.left_at is null
--   and member.notifications_enabled = true
--   and member.user_id is distinct from 'SENDER_USER_ID'::uuid;
