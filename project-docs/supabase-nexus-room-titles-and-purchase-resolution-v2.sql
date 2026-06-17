begin;

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
  next_sequence integer;
  generated_no text;
  generated_room_no text;
  fixed_profile_count integer;
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
    return jsonb_build_object(
      'document_no', document_row.document_no,
      'room_id', document_row.worktalk_room_id
    );
  end if;

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
  generated_room_no :=
    public.nexus_next_room_number('manufacturing');

  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  select count(*) into fixed_profile_count
  from public.profiles
  where name in ('장동철', '신영호', '신훈식', '신상민');

  if fixed_profile_count <> 4 then
    raise exception 'NEXUS manufacturing profiles are incomplete.';
  end if;

  delete from public.approval_lines
  where document_id = target_document_id;
  insert into public.approval_lines (
    document_id, step_order, role_label, approver_id,
    approver_name, approver_team, status
  )
  select
    target_document_id,
    case profile.name when '장동철' then 1 else 2 end,
    case profile.name
      when '장동철' then '1차 결재'
      else '2차 최종 결재'
    end,
    profile.id, profile.name, profile.team, 'pending'
  from public.profiles profile
  where profile.name in ('장동철', '신영호')
  order by case profile.name when '장동철' then 1 else 2 end;

  delete from public.approval_references
  where document_id = target_document_id;
  insert into public.approval_references (
    document_id, user_id, reference_name, reference_team
  )
  select target_document_id, profile.id, profile.name, profile.team
  from public.profiles profile
  where profile.name in ('신훈식', '신상민');

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
  values (new_room_id, auth.uid(), 'owner');

  insert into public.worktalk_room_members (
    room_id, user_id, member_role
  )
  select
    new_room_id,
    profile.id,
    case
      when profile.name in ('신훈식', '신상민') then 'viewer'
      else 'member'
    end
  from public.profiles profile
  where profile.name in ('장동철', '신영호', '신훈식', '신상민')
    and profile.id <> auth.uid()
  on conflict (room_id, user_id) do nothing;

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
  required_profile_count integer;
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
    return jsonb_build_object(
      'document_no', document_row.document_no,
      'room_id', document_row.worktalk_room_id
    );
  end if;

  generated_room_no := public.nexus_next_room_number('purchase');
  select * into requester_profile
  from public.profiles
  where id = auth.uid();

  select count(*) into required_profile_count
  from public.profiles
  where name in ('한차현', '장동철', '신영호', '최하영', '신상민');

  if required_profile_count <> 5 then
    raise exception 'NEXUS purchase resolution profiles are incomplete.';
  end if;

  delete from public.approval_lines
  where document_id = target_document_id;
  insert into public.approval_lines (
    document_id, step_order, role_label, approver_id,
    approver_name, approver_team, status
  )
  select
    target_document_id,
    case profile.name
      when '한차현' then 1
      when '장동철' then 2
      else 3
    end,
    case profile.name
      when '한차현' then '팀장'
      when '장동철' then '본부장'
      else '대표이사'
    end,
    profile.id, profile.name, profile.team, 'pending'
  from public.profiles profile
  where profile.name in ('한차현', '장동철', '신영호')
  order by case profile.name
    when '한차현' then 1
    when '장동철' then 2
    else 3
  end;

  delete from public.approval_references
  where document_id = target_document_id;
  insert into public.approval_references (
    document_id, user_id, reference_name, reference_team
  )
  select target_document_id, profile.id, profile.name, profile.team
  from public.profiles profile
  where profile.name in ('최하영', '신상민');

  insert into public.worktalk_rooms (room_type, title, created_by)
  values (
    'approval',
    '결재 구매 ' || generated_room_no,
    auth.uid()
  )
  returning id into new_room_id;

  insert into public.worktalk_room_members (
    room_id, user_id, member_role
  )
  values (new_room_id, auth.uid(), 'owner');

  insert into public.worktalk_room_members (
    room_id, user_id, member_role
  )
  select
    new_room_id,
    profile.id,
    case
      when profile.name in ('최하영', '신상민') then 'viewer'
      else 'member'
    end
  from public.profiles profile
  where profile.name in (
    '한차현', '장동철', '신영호', '최하영', '신상민'
  )
    and profile.id <> auth.uid()
  on conflict (room_id, user_id) do nothing;

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
      worktalk_room_id = new_room_id
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_room_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

grant execute on function public.nexus_finalize_manufacturing_submission(bigint)
to authenticated;
grant execute on function public.nexus_finalize_purchase_resolution_submission(bigint)
to authenticated;

create or replace function public.nexus_attach_purchase_resolution_pdf(
  target_document_id bigint,
  target_room_id bigint,
  target_message_id bigint,
  target_storage_path text,
  target_original_name text,
  target_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $function$
begin
  if not exists (
    select 1 from public.approval_documents document
    where document.id = target_document_id
      and document.requester_id = auth.uid()
      and document.worktalk_room_id = target_room_id
      and document.template_key = 'purchase_resolution'
  ) then
    raise exception 'Only the requester may attach this PDF.';
  end if;

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'nexus-documents'
      and object.name = target_storage_path
  ) then
    raise exception 'Uploaded NEXUS PDF was not found.';
  end if;

  insert into public.worktalk_files (
    room_id, message_id, storage_bucket, storage_path,
    original_name, mime_type, size_bytes, uploaded_by
  )
  values (
    target_room_id, target_message_id, 'nexus-documents',
    target_storage_path, target_original_name,
    'application/pdf', target_size_bytes, auth.uid()
  )
  on conflict (storage_path) do update
  set original_name = excluded.original_name,
      size_bytes = excluded.size_bytes;

  update public.approval_documents
  set submitted_pdf_path = target_storage_path,
      submitted_pdf_created_at = now()
  where id = target_document_id;
end;
$function$;

create or replace function public.nexus_attach_approved_purchase_resolution_pdf(
  target_document_id bigint,
  target_storage_path text,
  target_original_name text,
  target_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $function$
declare
  document_row public.approval_documents%rowtype;
  profile_row public.profiles%rowtype;
  new_message_id bigint;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and template_key = 'purchase_resolution'
    and status = 'approved';

  if document_row.id is null or document_row.worktalk_room_id is null then
    raise exception 'Approved purchase resolution was not found.';
  end if;

  if not exists (
    select 1 from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id = auth.uid()
      and line.status = 'approved'
  ) then
    raise exception 'Only an approving user may attach the final PDF.';
  end if;

  select * into profile_row
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_messages (
    room_id, sender_id, sender_name, sender_team,
    message_type, body, metadata
  )
  values (
    document_row.worktalk_room_id,
    auth.uid(),
    coalesce(profile_row.name, '결재자'),
    profile_row.team,
    'document',
    document_row.document_no ||
      ' 구매결의서의 최종 결재가 완료되었습니다.',
    jsonb_build_object(
      'approval_document_id', target_document_id,
      'document_no', document_row.document_no,
      'document_version', 'approved'
    )
  )
  returning id into new_message_id;

  insert into public.worktalk_files (
    room_id, message_id, storage_bucket, storage_path,
    original_name, mime_type, size_bytes, uploaded_by
  )
  values (
    document_row.worktalk_room_id, new_message_id,
    'nexus-documents', target_storage_path,
    target_original_name, 'application/pdf',
    target_size_bytes, auth.uid()
  )
  on conflict (storage_path) do update
  set message_id = excluded.message_id,
      original_name = excluded.original_name,
      size_bytes = excluded.size_bytes;

  update public.approval_documents
  set approved_pdf_path = target_storage_path,
      approved_pdf_created_at = now()
  where id = target_document_id;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = document_row.worktalk_room_id;
end;
$function$;

grant execute on function public.nexus_attach_purchase_resolution_pdf(
  bigint, bigint, bigint, text, text, bigint
) to authenticated;
grant execute on function public.nexus_attach_approved_purchase_resolution_pdf(
  bigint, text, text, bigint
) to authenticated;

notify pgrst, 'reload schema';
commit;
