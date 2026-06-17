-- NEXUS user/test data reset
-- Purpose:
--   Keep users, teams, memberships, default/fixed company rooms, SQL functions, and settings.
--   Remove user-created approval documents, approval rooms, direct rooms, custom non-fixed group rooms,
--   and clear messages/files/notifications from preserved default rooms.
--
-- Notes:
--   This does not delete physical files from Supabase Storage because direct deletion from
--   storage.objects is not allowed. It removes DB metadata and chat/file references.
--   If storage cleanup is needed later, use Supabase Storage API or the Storage UI.

begin;

create temp table if not exists nexus_reset_report (
  item text primary key,
  affected_count bigint not null default 0
);

create temp table nexus_reset_rooms_to_delete as
select id
from public.worktalk_rooms
where room_type in ('direct', 'approval')
   or (room_type = 'group' and coalesce(is_fixed, false) = false);

create temp table nexus_reset_rooms_to_keep as
select id
from public.worktalk_rooms
where id not in (select id from nexus_reset_rooms_to_delete)
  and (
    room_type in ('team', 'idea')
    or coalesce(is_fixed, false) = true
  );

insert into nexus_reset_report(item, affected_count)
select '삭제 대상 사용자 생성/결재/1:1 방', count(*) from nexus_reset_rooms_to_delete
on conflict (item) do update set affected_count = excluded.affected_count;

insert into nexus_reset_report(item, affected_count)
select '유지 대상 기본/고정 방', count(*) from nexus_reset_rooms_to_keep
on conflict (item) do update set affected_count = excluded.affected_count;

do $$
declare
  affected bigint;
begin
  if to_regclass('public.approval_attachments') is not null then
    execute 'delete from public.approval_attachments where document_id in (select id from public.approval_documents)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('결재 첨부 메타 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.approval_references') is not null then
    execute 'delete from public.approval_references where document_id in (select id from public.approval_documents)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('결재 참조 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.approval_notifications') is not null then
    execute 'delete from public.approval_notifications where document_id in (select id from public.approval_documents)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('결재 알림 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.approval_lines') is not null then
    execute 'delete from public.approval_lines where document_id in (select id from public.approval_documents)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('결재라인 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.approval_files') is not null then
    execute 'delete from public.approval_files where document_id in (select id from public.approval_documents)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('결재 파일 메타 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;
end $$;

do $$
declare
  affected bigint := 0;
  set_parts text[] := array[]::text[];
begin
  if to_regclass('public.equipment_orders') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'manufacturing_document_id'
    ) then
      set_parts := array_append(set_parts, 'manufacturing_document_id = null');
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'purchase_document_id'
    ) then
      set_parts := array_append(set_parts, 'purchase_document_id = null');
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'outsourcing_document_id'
    ) then
      set_parts := array_append(set_parts, 'outsourcing_document_id = null');
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'equipment_orders' and column_name = 'qa_document_id'
    ) then
      set_parts := array_append(set_parts, 'qa_document_id = null');
    end if;

    if array_length(set_parts, 1) is not null then
      execute 'update public.equipment_orders set ' || array_to_string(set_parts, ', ');
      get diagnostics affected = row_count;
    end if;
  end if;

  insert into nexus_reset_report values ('장비/진행현황 문서 연결 초기화', affected)
  on conflict (item) do update set affected_count = excluded.affected_count;
end $$;

do $$
declare
  affected bigint;
begin
  delete from public.approval_documents;
  get diagnostics affected = row_count;
  insert into nexus_reset_report values ('결재문서 삭제', affected)
  on conflict (item) do update set affected_count = excluded.affected_count;
end $$;

do $$
declare
  affected bigint;
begin
  if to_regclass('public.worktalk_message_files') is not null then
    execute 'delete from public.worktalk_message_files where room_id in (select id from nexus_reset_rooms_to_keep)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('기본방 파일 메타 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.worktalk_notifications') is not null then
    execute 'delete from public.worktalk_notifications where room_id in (select id from nexus_reset_rooms_to_keep)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('기본방 알림 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.worktalk_messages') is not null then
    execute 'delete from public.worktalk_messages where room_id in (select id from nexus_reset_rooms_to_keep)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('기본방 메시지 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.worktalk_room_members') is not null then
    execute 'update public.worktalk_room_members set last_read_message_id = null, last_read_at = null where room_id in (select id from nexus_reset_rooms_to_keep)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('기본방 읽음상태 초기화', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;

  if to_regclass('public.worktalk_rooms') is not null then
    execute 'update public.worktalk_rooms set last_message_at = now(), updated_at = now() where id in (select id from nexus_reset_rooms_to_keep)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('기본방 최근 메시지 초기화', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;
end $$;

do $$
declare
  affected bigint;
begin
  if to_regclass('public.worktalk_room_preferences') is not null then
    execute 'delete from public.worktalk_room_preferences where room_id in (select id from nexus_reset_rooms_to_delete)';
    get diagnostics affected = row_count;
    insert into nexus_reset_report values ('삭제방 개인정렬/설정 삭제', affected)
    on conflict (item) do update set affected_count = excluded.affected_count;
  end if;
end $$;

delete from public.worktalk_rooms
where id in (select id from nexus_reset_rooms_to_delete);

insert into nexus_reset_report(item, affected_count)
values ('사용자 생성/결재/1:1 방 삭제 완료', (select count(*) from nexus_reset_rooms_to_delete))
on conflict (item) do update set affected_count = excluded.affected_count;

select *
from nexus_reset_report
order by item;

commit;
