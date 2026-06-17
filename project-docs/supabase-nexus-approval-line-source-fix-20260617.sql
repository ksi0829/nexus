begin;

-- NEXUS approval line source fix
-- Apply this file after older NEXUS SQL files. It removes fixed approver/member
-- insertion from the finalization RPCs and makes approval_lines / approval_references
-- the only source of truth for room participants.

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
  where document_id = target_document_id
    and approver_id is not null;

  if line_count < 1 then
    raise exception 'At least one approval line is required.';
  end if;

  with ordered as (
    select
      line.id,
      row_number() over (order by line.step_order, line.id) as next_order,
      count(*) over () as total_count
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
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

  perform pg_advisory_xact_lock(hashtext('NEXUS-PI-' || current_date::text));

  select coalesce(max(right(document_no, 2)::integer), 0) + 1
  into next_sequence
  from public.approval_documents
  where document_no like 'PI-' || to_char(current_date, 'YYYYMMDD') || '-__';

  generated_no :=
    'PI-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    lpad(next_sequence::text, 2, '0');
  generated_room_no := public.nexus_next_room_number('manufacturing');

  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_rooms (room_type, title, created_by)
  values ('approval', '결재 제조 ' || generated_room_no, auth.uid())
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values (new_room_id, auth.uid(), 'owner')
  on conflict (room_id, user_id) do update
  set member_role = 'owner', left_at = null;

  with participants as (
    select line.approver_id as user_id, 'member'::text as member_role
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
    union all
    select reference.user_id, 'viewer'::text as member_role
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
  insert into public.worktalk_room_members (room_id, user_id, member_role)
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
      status = 'pending',
      current_step = 1,
      form_data = jsonb_set(form_data, '{documentNo}', to_jsonb(generated_no), true)
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_no,
    'room_document_no', generated_room_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

create or replace function public.nexus_finalize_work_order_submission(
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
  generated_room_no text;
  generated_document_no text;
  new_room_id bigint;
  new_message_id bigint;
  existing_message_id bigint;
  market_type text;
  required_profile_count integer;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and requester_id = auth.uid()
    and template_key = 'work_order';

  if document_row.id is null then
    raise exception 'NEXUS work order document was not found.';
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

  market_type := coalesce(nullif(document_row.form_data->>'marketType', ''), '국내');

  if market_type not in ('국내', '해외') then
    raise exception 'Work order marketType must be 국내 or 해외.';
  end if;

  generated_room_no := public.nexus_next_room_number('production-work-order');
  generated_document_no := '작업 생산 ' || generated_room_no;

  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  select count(distinct profile.name) into required_profile_count
  from public.profiles profile
  where profile.name in (
    '한차현',
    '한재영',
    '권영일',
    '김학',
    '박상현',
    '이승준',
    '김종혁'
  )
  or (
    market_type = '국내'
    and profile.name in ('김선일')
  )
  or (
    market_type = '해외'
    and profile.name in ('이양로', '반준영')
  );

  if (
    market_type = '국내'
    and required_profile_count < 8
  ) or (
    market_type = '해외'
    and required_profile_count < 9
  ) then
    raise exception 'NEXUS work order participant profiles are incomplete.';
  end if;

  delete from public.approval_lines
  where document_id = target_document_id;

  delete from public.approval_references
  where document_id = target_document_id;

  insert into public.approval_references (
    document_id, user_id, reference_name, reference_team
  )
  select target_document_id, profile.id, profile.name, profile.team
  from public.profiles profile
  where profile.id <> auth.uid()
    and (
      profile.name in (
        '한차현',
        '한재영',
        '권영일',
        '김학',
        '박상현',
        '이승준',
        '김종혁'
      )
      or (
        market_type = '국내'
        and profile.name in ('김선일')
      )
      or (
        market_type = '해외'
        and profile.name in ('이양로', '반준영')
      )
    )
  order by case profile.name
    when '한차현' then 10
    when '한재영' then 20
    when '권영일' then 30
    when '김학' then 40
    when '박상현' then 50
    when '이승준' then 60
    when '김종혁' then 70
    when '김선일' then 80
    when '이양로' then 80
    when '반준영' then 90
    else 999
  end;

  insert into public.worktalk_rooms (room_type, title, created_by)
  values ('group', generated_document_no, auth.uid())
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values (new_room_id, auth.uid(), 'owner')
  on conflict (room_id, user_id) do update
  set member_role = 'owner', left_at = null;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  select new_room_id, profile.id, 'member'
  from public.profiles profile
  where profile.id <> auth.uid()
    and (
      profile.name in (
        '한차현',
        '한재영',
        '권영일',
        '김학',
        '박상현',
        '이승준',
        '김종혁'
      )
      or (
        market_type = '국내'
        and profile.name in ('김선일')
      )
      or (
        market_type = '해외'
        and profile.name in ('이양로', '반준영')
      )
    )
  on conflict (room_id, user_id) do update
  set member_role = 'member',
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
      '님이 ' || document_row.title || ' 작업지시서를 발행했습니다.',
    jsonb_build_object(
      'approval_document_id', document_row.id,
      'document_no', generated_document_no,
      'room_document_no', generated_room_no,
      'document_type', 'work_order',
      'market_type', market_type
    )
  )
  returning id into new_message_id;

  insert into public.approval_notifications (user_id, document_id, message)
  select
    member.user_id,
    target_document_id,
    generated_document_no || ' 작업지시서가 발행되었습니다.'
  from public.worktalk_room_members member
  where member.room_id = new_room_id
    and member.user_id <> auth.uid()
  on conflict do nothing;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = new_room_id;

  update public.approval_documents
  set document_no = generated_document_no,
      worktalk_room_id = new_room_id,
      status = 'approved',
      current_step = 0,
      completed_at = now(),
      form_data = jsonb_set(
        jsonb_set(form_data, '{documentNo}', to_jsonb(generated_document_no), true),
        '{roomDocumentNo}', to_jsonb(generated_room_no), true
      )
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_document_no,
    'room_document_no', generated_room_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

create or replace function public.nexus_finalize_purchase_submission(
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
  request_label text;
  subject_text text;
  sequence_value integer;
  generated_no text;
  generated_room_no text;
  new_room_id bigint;
  new_message_id bigint;
  existing_message_id bigint;
  line_count integer;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and requester_id = auth.uid()
    and template_key = 'purchase_request';

  if document_row.id is null then
    raise exception 'Purchase document not found.';
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
  where document_id = target_document_id
    and approver_id is not null;

  if line_count < 1 then
    raise exception 'At least one approval line is required.';
  end if;

  with ordered as (
    select
      line.id,
      row_number() over (order by line.step_order, line.id) as next_order,
      count(*) over () as total_count
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
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

  request_label := case
    when document_row.form_data->>'requestType' = '외주' then '외주의뢰서'
    else '구매의뢰서'
  end;
  subject_text := coalesce(
    nullif(document_row.form_data->>'equipment', ''),
    nullif(document_row.form_data->>'client', ''),
    document_row.title
  );

  insert into public.nexus_document_sequences (
    document_type, sequence_year, last_value
  )
  values ('purchase', extract(year from current_date)::integer, 1)
  on conflict (document_type, sequence_year)
  do update set
    last_value = public.nexus_document_sequences.last_value + 1,
    updated_at = now()
  returning last_value into sequence_value;

  generated_no :=
    'E' || to_char(current_date, 'YYYYMMDD') || '-' ||
    lpad(sequence_value::text, 3, '0');
  generated_room_no := public.nexus_next_room_number('technical1');

  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_rooms (room_type, title, created_by)
  values ('approval', '결재 기술1 ' || generated_room_no, auth.uid())
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values (new_room_id, auth.uid(), 'owner')
  on conflict (room_id, user_id) do update
  set member_role = 'owner', left_at = null;

  with participants as (
    select line.approver_id as user_id, 'member'::text as member_role
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
    union all
    select reference.user_id, 'viewer'::text as member_role
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
  insert into public.worktalk_room_members (room_id, user_id, member_role)
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
      '님이 ' || subject_text || '에 대한 ' || request_label || '를 상신합니다.',
    jsonb_build_object(
      'approval_document_id', document_row.id,
      'document_no', generated_no,
      'room_document_no', generated_room_no,
      'document_type', request_label
    )
  )
  returning id into new_message_id;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = new_room_id;

  update public.approval_documents
  set document_no = generated_no,
      worktalk_room_id = new_room_id,
      status = 'pending',
      current_step = 1,
      form_data = jsonb_set(form_data, '{controlNo}', to_jsonb(generated_no), true)
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_no,
    'room_document_no', generated_room_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

create or replace function public.nexus_finalize_purchase_resolution_submission(
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
  generated_room_no text;
  new_room_id bigint;
  new_message_id bigint;
  existing_message_id bigint;
  line_count integer;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and requester_id = auth.uid()
    and template_key = 'purchase_resolution';

  if document_row.id is null then
    raise exception 'Purchase resolution document not found.';
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
  where document_id = target_document_id
    and approver_id is not null;

  if line_count < 1 then
    raise exception 'At least one approval line is required.';
  end if;

  with ordered as (
    select
      line.id,
      row_number() over (order by line.step_order, line.id) as next_order,
      count(*) over () as total_count
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
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

  generated_room_no := public.nexus_next_room_number('purchase');

  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_rooms (room_type, title, created_by)
  values ('approval', '결재 구매 ' || generated_room_no, auth.uid())
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values (new_room_id, auth.uid(), 'owner')
  on conflict (room_id, user_id) do update
  set member_role = 'owner', left_at = null;

  with participants as (
    select line.approver_id as user_id, 'member'::text as member_role
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id is not null
    union all
    select reference.user_id, 'viewer'::text as member_role
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
  insert into public.worktalk_room_members (room_id, user_id, member_role)
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
      '님이 ' || coalesce(
        nullif(document_row.form_data->>'vendorName', ''),
        document_row.title
      ) || ' 구매결의서를 상신합니다.',
    jsonb_build_object(
      'approval_document_id', document_row.id,
      'document_no', generated_room_no,
      'document_type', '구매결의서'
    )
  )
  returning id into new_message_id;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = new_room_id;

  update public.approval_documents
  set document_no = generated_room_no,
      worktalk_room_id = new_room_id,
      status = 'pending',
      current_step = 1
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_room_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

grant execute on function public.nexus_finalize_manufacturing_submission(bigint) to authenticated;
grant execute on function public.nexus_finalize_work_order_submission(bigint) to authenticated;
grant execute on function public.nexus_finalize_purchase_submission(bigint) to authenticated;
grant execute on function public.nexus_finalize_purchase_resolution_submission(bigint) to authenticated;

commit;
