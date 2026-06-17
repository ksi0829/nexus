-- NEXUS light operational fixes
-- Apply this in Supabase SQL Editor after deploying the NEXUS standalone app.
--
-- Goal:
-- 1. Allow submitted PDFs to attach to the visible room message even if the
--    initial document message metadata is missing or incomplete.
-- 2. Preserve document metadata once the PDF is attached.

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
declare
  document_row public.approval_documents%rowtype;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and requester_id = auth.uid()
    and worktalk_room_id = target_room_id
    and template_key = 'manufacturing_request';

  if document_row.id is null then
    raise exception 'Only the requester may attach this manufacturing PDF.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_message_id
      and message.room_id = target_room_id
  ) then
    raise exception 'The target WorkTalk message was not found.';
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
  set message_id = excluded.message_id,
      original_name = excluded.original_name,
      size_bytes = excluded.size_bytes;

  update public.approval_documents
  set submitted_pdf_path = target_storage_path,
      submitted_pdf_created_at = now()
  where id = target_document_id;

  update public.worktalk_messages
  set message_type = 'document',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'approval_document_id', target_document_id,
        'document_no', document_row.document_no,
        'document_version', 'submitted',
        'pdf_path', target_storage_path,
        'pdf_bucket', 'nexus-documents'
      )
  where id = target_message_id;
end;
$function$;

grant execute on function public.nexus_attach_manufacturing_pdf(
  bigint, bigint, bigint, text, text, bigint
) to authenticated;

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
declare
  document_row public.approval_documents%rowtype;
begin
  select * into document_row
  from public.approval_documents
  where id = target_document_id
    and requester_id = auth.uid()
    and worktalk_room_id = target_room_id
    and template_key = 'purchase_request';

  if document_row.id is null then
    raise exception 'Only the requester may attach this purchase PDF.';
  end if;

  if not exists (
    select 1
    from public.worktalk_messages message
    where message.id = target_message_id
      and message.room_id = target_room_id
  ) then
    raise exception 'The target WorkTalk message was not found.';
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
  set message_id = excluded.message_id,
      original_name = excluded.original_name,
      size_bytes = excluded.size_bytes;

  update public.approval_documents
  set submitted_pdf_path = target_storage_path,
      submitted_pdf_created_at = now()
  where id = target_document_id;

  update public.worktalk_messages
  set message_type = 'document',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'approval_document_id', target_document_id,
        'document_no', document_row.document_no,
        'document_version', 'submitted',
        'pdf_path', target_storage_path,
        'pdf_bucket', 'nexus-documents'
      )
  where id = target_message_id;
end;
$function$;

grant execute on function public.nexus_attach_purchase_pdf(
  bigint, bigint, bigint, text, text, bigint
) to authenticated;
