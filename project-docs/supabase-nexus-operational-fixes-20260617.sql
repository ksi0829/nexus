begin;

-- 1) 제조요구서 상신 시 화면에서 저장된 결재라인/참조자를 그대로 사용한다.
--    이전 함수는 장동철/신영호/신훈식/신상민을 고정으로 다시 삽입해서
--    화면에서 삭제한 결재자가 DB와 채팅방에 되살아나는 문제가 있었다.
create or replace function public.nexus_finalize_manufacturing_submission(
  target_document_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  document_row public.approval_documents%rowtype;
  requester_profile public.profiles%rowtype;
  new_room_id bigint;
  new_message_id bigint;
  existing_message_id bigint;
  next_sequence integer;
  generated_no text;
  generated_room_no text;
  line_count integer;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and requester_id = auth.uid()
    and template_key = 'manufacturing_request';

  if document_row.id is null then
    raise exception 'Manufacturing document not found.';
  end if;

  if document_row.document_no is not null
     and document_row.worktalk_room_id is not null then
    select message.id into existing_message_id
    from public.worktalk_messages message
    where message.room_id = document_row.worktalk_room_id
      and message.message_type = 'document'
      and (message.metadata->>'approval_document_id')::bigint = document_row.id
    order by message.id desc
    limit 1;

    return jsonb_build_object(
      'document_no', document_row.document_no,
      'room_id', document_row.worktalk_room_id,
      'message_id', existing_message_id
    );
  end if;

  select count(*) into line_count
  from public.approval_lines
  where document_id = target_document_id;

  if line_count < 1 then
    raise exception 'At least one approval line is required.';
  end if;

  -- 삭제 후 남은 결재자 기준으로 순서를 1부터 다시 정렬한다.
  with ordered as (
    select
      line.id,
      row_number() over (order by line.step_order, line.id) as next_order,
      count(*) over () as total_count
    from public.approval_lines line
    where line.document_id = target_document_id
  )
  update public.approval_lines line
  set
    step_order = ordered.next_order,
    role_label = case
      when ordered.total_count = 1 then '1차 최종 결재'
      when ordered.next_order = ordered.total_count then ordered.next_order::text || '차 최종 결재'
      else ordered.next_order::text || '차 결재'
    end,
    status = 'pending',
    acted_at = null,
    memo = null
  from ordered
  where line.id = ordered.id;

  perform pg_advisory_xact_lock(
    hashtext('NEXUS-PI-' || current_date::text)
  );

  select coalesce(max(right(document_no, 2)::integer), 0) + 1
  into next_sequence
  from public.approval_documents
  where document_no like
    'PI-' || to_char(current_date, 'YYYYMMDD') || '-__';

  generated_no :=
    'PI-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    lpad(next_sequence::text, 2, '0');
  generated_room_no := public.nexus_next_room_number('manufacturing');

  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_rooms (room_type, title, created_by)
  values (
    'approval',
    '결재 제조 ' || generated_room_no,
    auth.uid()
  )
  returning id into new_room_id;

  insert into public.worktalk_room_members (
    room_id, user_id, member_role
  )
  values (new_room_id, auth.uid(), 'owner')
  on conflict (room_id, user_id) do update
  set member_role = 'owner', left_at = null;

  with participants as (
    select
      line.approver_id as user_id,
      'member'::text as member_role
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
    union all
    select
      reference.user_id,
      'viewer'::text as member_role
    from public.approval_references reference
    where reference.document_id = target_document_id
      and reference.user_id is not null
  ),
  unique_participants as (
    select
      user_id,
      case when bool_or(member_role = 'member') then 'member' else 'viewer' end as member_role
    from participants
    where user_id <> auth.uid()
    group by user_id
  )
  insert into public.worktalk_room_members (
    room_id, user_id, member_role
  )
  select new_room_id, user_id, member_role
  from unique_participants
  on conflict (room_id, user_id) do update
  set member_role = excluded.member_role,
      left_at = null;

  insert into public.worktalk_messages (
    room_id, sender_id, sender_name, sender_team,
    message_type, body, metadata
  )
  values (
    new_room_id,
    auth.uid(),
    coalesce(requester_profile.name, document_row.requester_name),
    requester_profile.team,
    'document',
    coalesce(requester_profile.name, document_row.requester_name) ||
      '님이 ' || document_row.title || '에 대한 제조요구서를 상신합니다.',
    jsonb_build_object(
      'approval_document_id', document_row.id,
      'document_no', generated_no,
      'room_document_no', generated_room_no
    )
  )
  returning id into new_message_id;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = new_room_id;

  update public.approval_documents
  set document_no = generated_no,
      worktalk_room_id = new_room_id,
      current_step = 1,
      form_data = jsonb_set(
        form_data, '{documentNo}', to_jsonb(generated_no), true
      )
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_no,
    'room_document_no', generated_room_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

grant execute on function public.nexus_finalize_manufacturing_submission(bigint)
to authenticated;

-- 2) 공지글은 일반 그룹방뿐 아니라 기본/고정 그룹방에서도 사용할 수 있게 한다.
create or replace function public.worktalk_set_room_notice(
  target_room_id bigint,
  target_message_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  room_row public.worktalk_rooms%rowtype;
begin
  select * into room_row
  from public.worktalk_rooms
  where id = target_room_id;

  if room_row.id is null or room_row.room_type <> 'group' then
    raise exception 'Only group rooms support notices.';
  end if;

  if not exists (
    select 1
    from public.worktalk_room_members member
    where member.room_id = target_room_id
      and member.user_id = auth.uid()
      and member.left_at is null
  ) and not public.worktalk_is_privileged() then
    raise exception 'Only room members may pin notices.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_message_id
      and message.room_id = target_room_id
      and message.message_type <> 'system'
  ) then
    raise exception 'Notice message was not found.';
  end if;

  insert into public.worktalk_room_notices (
    room_id, message_id, pinned_by, pinned_at
  )
  values (
    target_room_id, target_message_id, auth.uid(), now()
  )
  on conflict (room_id)
  do update set
    message_id = excluded.message_id,
    pinned_by = excluded.pinned_by,
    pinned_at = excluded.pinned_at;
end;
$function$;

create or replace function public.worktalk_clear_room_notice(
  target_room_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (
    select 1
    from public.worktalk_room_members member
    join public.worktalk_rooms room on room.id = member.room_id
    where member.room_id = target_room_id
      and member.user_id = auth.uid()
      and member.left_at is null
      and room.room_type = 'group'
  ) and not public.worktalk_is_privileged() then
    raise exception 'Only room members may clear notices.';
  end if;

  delete from public.worktalk_room_notices
  where room_id = target_room_id;
end;
$function$;

grant execute on function public.worktalk_set_room_notice(bigint, bigint)
to authenticated;
grant execute on function public.worktalk_clear_room_notice(bigint)
to authenticated;

commit;
