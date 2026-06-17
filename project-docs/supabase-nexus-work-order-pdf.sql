-- NEXUS work order PDF attachment
-- Apply this in the existing worklog Supabase project SQL Editor.
--
-- The storage bucket policy in supabase-nexus-storage-rls-fix-20260617.sql
-- already allows:
-- work-order/YYYY/MM/DD/{safe_work_order_key}/submitted.pdf
-- Example: work-order/2026/06/17/WO-26-2/submitted.pdf

create or replace function public.nexus_attach_work_order_pdf(
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
    and template_key = 'work_order';

  if document_row.id is null then
    raise exception 'Only the requester may attach this work order PDF.';
  end if;

  if target_storage_path !~ '^work-order/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/submitted[.]pdf$' then
    raise exception 'Invalid work order PDF path.';
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
    raise exception 'Uploaded NEXUS work order PDF was not found.';
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
        'document_type', 'work_order',
        'pdf_path', target_storage_path,
        'pdf_bucket', 'nexus-documents'
      )
  where id = target_message_id;
end;
$function$;

grant execute on function public.nexus_attach_work_order_pdf(
  bigint, bigint, bigint, text, text, bigint
) to authenticated;
