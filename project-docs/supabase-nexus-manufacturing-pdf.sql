begin;

alter table public.approval_documents
  add column if not exists submitted_pdf_path text,
  add column if not exists submitted_pdf_created_at timestamptz,
  add column if not exists approved_pdf_path text,
  add column if not exists approved_pdf_created_at timestamptz;

alter table public.worktalk_files
  add column if not exists storage_bucket text not null default 'worktalk-files';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nexus-documents',
  'nexus-documents',
  false,
  31457280,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "nexus_documents_insert_own" on storage.objects;
create policy "nexus_documents_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'nexus-documents'
  and owner_id = auth.uid()::text
  and name like 'manufacturing/%'
);

drop policy if exists "nexus_documents_update_own" on storage.objects;
create policy "nexus_documents_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'nexus-documents'
  and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'nexus-documents'
  and owner_id = auth.uid()::text
);

drop policy if exists "nexus_documents_select_participant" on storage.objects;
create policy "nexus_documents_select_participant"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'nexus-documents'
  and exists (
    select 1
    from public.worktalk_files file
    where file.storage_bucket = 'nexus-documents'
      and file.storage_path = name
      and public.worktalk_can_view_room(file.room_id)
  )
);

create or replace function public.nexus_attach_manufacturing_pdf(
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
      and document.template_key = 'manufacturing_request'
  ) then
    raise exception 'Only the requester may attach this manufacturing PDF.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_message_id
      and message.room_id = target_room_id
      and (message.metadata->>'approval_document_id')::bigint = target_document_id
  ) then
    raise exception 'The NEXUS document message was not found.';
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
    room_id,
    message_id,
    storage_bucket,
    storage_path,
    original_name,
    mime_type,
    size_bytes,
    uploaded_by
  )
  values (
    target_room_id,
    target_message_id,
    'nexus-documents',
    target_storage_path,
    target_original_name,
    'application/pdf',
    target_size_bytes,
    auth.uid()
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

grant execute on function public.nexus_attach_manufacturing_pdf(
  bigint, bigint, bigint, text, text, bigint
) to authenticated;

create or replace function public.nexus_attach_approved_manufacturing_pdf(
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
    and template_key = 'manufacturing_request'
    and status = 'approved';

  if document_row.id is null or document_row.worktalk_room_id is null then
    raise exception 'Approved NEXUS manufacturing document was not found.';
  end if;

  if not exists (
    select 1 from public.approval_lines line
    where line.document_id = target_document_id
      and line.approver_id = auth.uid()
      and line.status = 'approved'
  ) then
    raise exception 'Only an approving user may attach the final PDF.';
  end if;

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'nexus-documents'
      and object.name = target_storage_path
  ) then
    raise exception 'Uploaded final PDF was not found.';
  end if;

  select * into profile_row from public.profiles where id = auth.uid();

  insert into public.worktalk_messages (
    room_id, sender_id, sender_name, sender_team, message_type, body, metadata
  )
  values (
    document_row.worktalk_room_id,
    auth.uid(),
    coalesce(profile_row.name, '결재자'),
    profile_row.team,
    'document',
    document_row.document_no || ' 제조요구서의 최종 결재가 완료되었습니다.',
    jsonb_build_object(
      'approval_document_id', target_document_id,
      'document_no', document_row.document_no,
      'document_version', 'approved'
    )
  )
  returning id into new_message_id;

  insert into public.worktalk_files (
    room_id, message_id, storage_bucket, storage_path, original_name,
    mime_type, size_bytes, uploaded_by
  )
  values (
    document_row.worktalk_room_id, new_message_id, 'nexus-documents',
    target_storage_path, target_original_name, 'application/pdf',
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

grant execute on function public.nexus_attach_approved_manufacturing_pdf(
  bigint, text, text, bigint
) to authenticated;

notify pgrst, 'reload schema';
commit;
