begin;

create table if not exists public.nexus_document_sequences (
  document_type text not null,
  sequence_year integer not null,
  last_value integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (document_type, sequence_year)
);

create table if not exists public.nexus_room_sequences (
  room_category text not null,
  sequence_year integer not null,
  last_value integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_category, sequence_year)
);

-- 첫 테스트 방을 각각 기술1 26-29, 제조 26-21, 구매 26-48로 만드는 기준값입니다.
insert into public.nexus_room_sequences (room_category, sequence_year, last_value)
values
  ('technical1', 2026, 28),
  ('manufacturing', 2026, 20),
  ('purchase', 2026, 47)
on conflict (room_category, sequence_year) do nothing;

create or replace function public.nexus_next_room_number(target_category text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  next_value integer;
begin
  insert into public.nexus_room_sequences (
    room_category, sequence_year, last_value
  )
  values (target_category, extract(year from current_date)::integer, 1)
  on conflict (room_category, sequence_year)
  do update set
    last_value = public.nexus_room_sequences.last_value + 1,
    updated_at = now()
  returning last_value into next_value;

  return to_char(current_date, 'YY') || '-' || next_value::text;
end;
$function$;

-- 샘플 문서 E20260605-029를 기준으로 한 임시 시작값입니다.
-- 실제 적용 직전에 올해 최신 번호가 다르면 29를 최신 번호로 바꾸세요.
insert into public.nexus_document_sequences (document_type, sequence_year, last_value)
values ('purchase', 2026, 29)
on conflict (document_type, sequence_year) do nothing;

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
  required_profile_count integer;
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
    return jsonb_build_object(
      'document_no', document_row.document_no,
      'room_id', document_row.worktalk_room_id
    );
  end if;

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

  select count(*) into required_profile_count
  from public.profiles
  where name in (
    '한차현', '장동철', '신영호',
    '한재영', '권영일', '김학', '박상현',
    '신훈식', '최하영'
  );

  if required_profile_count <> 9 then
    raise exception 'NEXUS purchase approver/reference profiles are incomplete.';
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
    profile.id,
    profile.name,
    profile.team,
    'pending'
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
  select
    target_document_id,
    profile.id,
    profile.name,
    profile.team
  from public.profiles profile
  where (
      profile.name in ('한재영', '권영일', '김학', '박상현')
      and profile.id <> auth.uid()
    )
    or profile.name in ('신훈식', '최하영');

  insert into public.worktalk_rooms (room_type, title, created_by)
  values (
    'approval',
    '결재 기술1 ' || generated_room_no,
    auth.uid()
  )
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values (new_room_id, auth.uid(), 'owner');

  insert into public.worktalk_room_members (
    room_id, user_id, member_role
  )
  select
    new_room_id,
    profile.id,
    case
      when profile.name in (
        '한재영', '권영일', '김학', '박상현', '신훈식', '최하영'
      ) then 'viewer'
      else 'member'
    end
  from public.profiles profile
  where (
      profile.name in (
        '한차현', '장동철', '신영호',
        '한재영', '권영일', '김학', '박상현',
        '신훈식', '최하영'
      )
      and profile.id <> auth.uid()
    )
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
      form_data = jsonb_set(
        form_data,
        '{controlNo}',
        to_jsonb(generated_no),
        true
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

grant execute on function public.nexus_finalize_purchase_submission(bigint)
to authenticated;

drop policy if exists "nexus_documents_insert_own" on storage.objects;
create policy "nexus_documents_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'nexus-documents'
  and owner_id = auth.uid()::text
  and (
    name like 'manufacturing/%'
    or name like 'purchase/%'
    or name like 'purchase-resolution/%'
  )
);

create or replace function public.nexus_attach_purchase_pdf(
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
    select 1
    from public.approval_documents document
    where document.id = target_document_id
      and document.requester_id = auth.uid()
      and document.worktalk_room_id = target_room_id
      and document.template_key = 'purchase_request'
  ) then
    raise exception 'Only the requester may attach this purchase PDF.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_message_id
      and message.room_id = target_room_id
      and (message.metadata->>'approval_document_id')::bigint =
        target_document_id
  ) then
    raise exception 'The NEXUS purchase message was not found.';
  end if;

  if target_size_bytes <= 0 or target_size_bytes > 31457280 then
    raise exception 'Invalid PDF size.';
  end if;

  if not exists (
    select 1
    from storage.objects object
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

  update public.worktalk_messages
  set metadata = metadata || jsonb_build_object(
    'pdf_path', target_storage_path,
    'pdf_bucket', 'nexus-documents'
  )
  where id = target_message_id;
end;
$function$;

grant execute on function public.nexus_attach_purchase_pdf(
  bigint, bigint, bigint, text, text, bigint
) to authenticated;

create or replace function public.nexus_attach_approved_purchase_pdf(
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
  request_label text;
  new_message_id bigint;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and template_key = 'purchase_request'
    and status = 'approved';

  if document_row.id is null or document_row.worktalk_room_id is null then
    raise exception 'Approved NEXUS purchase document was not found.';
  end if;

  if not exists (
    select 1
    from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id = auth.uid()
      and line.status = 'approved'
  ) then
    raise exception 'Only an approving user may attach the final PDF.';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'nexus-documents'
      and object.name = target_storage_path
  ) then
    raise exception 'Uploaded final PDF was not found.';
  end if;

  request_label := case
    when document_row.form_data->>'requestType' = '외주' then '외주의뢰서'
    else '구매의뢰서'
  end;
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
    document_row.document_no || ' ' || request_label ||
      '의 최종 결재가 완료되었습니다.',
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

grant execute on function public.nexus_attach_approved_purchase_pdf(
  bigint, text, text, bigint
) to authenticated;

notify pgrst, 'reload schema';
commit;
