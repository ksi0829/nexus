begin;

create or replace function public.nexus_process_chat_approval_command(
  target_room_id bigint,
  command_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  document_row public.approval_documents%rowtype;
  line_row public.approval_lines%rowtype;
  profile_row public.profiles%rowtype;
  normalized_command text;
  rejection_reason text;
  next_line public.approval_lines%rowtype;
  command_message_id bigint;
  result_message_id bigint;
  completed boolean := false;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  normalized_command := btrim(coalesce(command_text, ''));

  if normalized_command <> '승인'
     and normalized_command !~ '^반려([[:space:]]*[:：][[:space:]]*|[[:space:]]+).+' then
    raise exception '결재 명령은 승인 또는 반려: 사유 형식이어야 합니다.';
  end if;

  select *
  into document_row
  from public.approval_documents
  where worktalk_room_id = target_room_id
    and status = 'pending'
  order by id desc
  limit 1
  for update;

  if document_row.id is null then
    raise exception '이 결재방에 진행 중인 문서가 없습니다.';
  end if;

  select *
  into line_row
  from public.approval_lines
  where document_id = document_row.id
    and status = 'pending'
  order by step_order
  limit 1
  for update;

  if line_row.id is null then
    raise exception '처리할 결재 단계가 없습니다.';
  end if;

  if line_row.approver_id is distinct from auth.uid() then
    raise exception '현재 결재 순서의 결재자만 처리할 수 있습니다.';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_messages (
    room_id,
    sender_id,
    sender_name,
    sender_team,
    message_type,
    body,
    metadata
  )
  values (
    target_room_id,
    auth.uid(),
    coalesce(profile_row.name, line_row.approver_name, '결재자'),
    profile_row.team,
    'text',
    normalized_command,
    jsonb_build_object(
      'approval_command', true,
      'document_id', document_row.id
    )
  )
  returning id into command_message_id;

  if normalized_command = '승인' then
    update public.approval_lines
    set
      status = 'approved',
      acted_at = now(),
      memo = null
    where id = line_row.id;

    select *
    into next_line
    from public.approval_lines
    where document_id = document_row.id
      and status = 'pending'
    order by step_order
    limit 1;

    if next_line.id is null then
      completed := true;
      update public.approval_documents
      set
        status = 'approved',
        completed_at = now()
      where id = document_row.id;

      insert into public.approval_notifications (user_id, document_id, message)
      values (
        document_row.requester_id,
        document_row.id,
        document_row.title || ' 최종 결재가 완료되었습니다.'
      );

      insert into public.worktalk_messages (
        room_id, sender_id, sender_name, sender_team,
        message_type, body, metadata
      )
      values (
        target_room_id, null, 'NEXUS', null,
        'system',
        coalesce(profile_row.name, line_row.approver_name) ||
          '님이 승인했습니다. 모든 결재가 완료되었습니다.',
        jsonb_build_object(
          'approval_result', 'approved',
          'document_id', document_row.id,
          'completed', true
        )
      )
      returning id into result_message_id;
    else
      update public.approval_documents
      set current_step = next_line.step_order
      where id = document_row.id;

      insert into public.approval_notifications (user_id, document_id, message)
      values (
        next_line.approver_id,
        document_row.id,
        document_row.title || ' 결재 순서가 도착했습니다.'
      );

      insert into public.worktalk_messages (
        room_id, sender_id, sender_name, sender_team,
        message_type, body, metadata
      )
      values (
        target_room_id, null, 'NEXUS', null,
        'system',
        coalesce(profile_row.name, line_row.approver_name) ||
          '님이 승인했습니다. 다음 결재자는 ' ||
          next_line.approver_name || '님입니다.',
        jsonb_build_object(
          'approval_result', 'approved',
          'document_id', document_row.id,
          'next_approver_id', next_line.approver_id,
          'completed', false
        )
      )
      returning id into result_message_id;
    end if;
  else
    rejection_reason := btrim(
      regexp_replace(
        normalized_command,
        '^반려([[:space:]]*[:：][[:space:]]*|[[:space:]]+)',
        ''
      )
    );

    if rejection_reason = '' then
      raise exception '반려 사유를 입력해 주세요.';
    end if;

    update public.approval_lines
    set
      status = 'rejected',
      acted_at = now(),
      memo = rejection_reason
    where id = line_row.id;

    update public.approval_documents
    set
      status = 'rejected',
      completed_at = now()
    where id = document_row.id;

    insert into public.approval_notifications (user_id, document_id, message)
    values (
      document_row.requester_id,
      document_row.id,
      document_row.title || ' 문서가 반려되었습니다. 사유: ' || rejection_reason
    );

    insert into public.worktalk_messages (
      room_id, sender_id, sender_name, sender_team,
      message_type, body, metadata
    )
    values (
      target_room_id, null, 'NEXUS', null,
      'system',
      coalesce(profile_row.name, line_row.approver_name) ||
        '님이 문서를 반려했습니다. 사유: ' || rejection_reason,
      jsonb_build_object(
        'approval_result', 'rejected',
        'document_id', document_row.id,
        'reason', rejection_reason
      )
    )
    returning id into result_message_id;
  end if;

  update public.worktalk_rooms
  set
    last_message_at = now(),
    updated_at = now()
  where id = target_room_id;

  update public.worktalk_room_members
  set
    last_read_message_id = result_message_id,
    last_read_at = now()
  where room_id = target_room_id
    and user_id = auth.uid();

  return jsonb_build_object(
    'handled', true,
    'document_id', document_row.id,
    'document_no', document_row.document_no,
    'template_key', document_row.template_key,
    'result', case when normalized_command = '승인' then 'approved' else 'rejected' end,
    'completed', completed,
    'message_id', result_message_id
  );
end;
$function$;

grant execute on function public.nexus_process_chat_approval_command(bigint, text)
to authenticated;

commit;
