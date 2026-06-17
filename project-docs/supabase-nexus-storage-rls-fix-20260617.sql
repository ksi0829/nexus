-- NEXUS Storage RLS fix for generated approval PDFs
-- Apply this in the existing worklog Supabase project SQL Editor.
--
-- This does not expose any service-role key to the browser.
-- It only allows authenticated users to upload/read NEXUS-generated PDF files
-- under controlled document paths in the private nexus-documents bucket.

begin;

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
drop policy if exists "nexus_documents_update_own" on storage.objects;
drop policy if exists "nexus_documents_select_participant" on storage.objects;

drop policy if exists "nexus_documents_insert_authenticated_paths" on storage.objects;
create policy "nexus_documents_insert_authenticated_paths"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'nexus-documents'
  and (
    name ~ '^manufacturing/[0-9]{4}/[0-9]{2}/[0-9]{2}/PI-[0-9]{8}-[0-9]{2}/(submitted|approved)[.]pdf$'
    or name ~ '^purchase/[0-9]{4}/[0-9]{2}/[0-9]{2}/E[0-9]{8}-[0-9]{3}/(submitted|approved)[.]pdf$'
    or name ~ '^purchase-resolution/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
    or name ~ '^work-order/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
  )
);

drop policy if exists "nexus_documents_update_authenticated_paths" on storage.objects;
create policy "nexus_documents_update_authenticated_paths"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'nexus-documents'
  and (
    name ~ '^manufacturing/[0-9]{4}/[0-9]{2}/[0-9]{2}/PI-[0-9]{8}-[0-9]{2}/(submitted|approved)[.]pdf$'
    or name ~ '^purchase/[0-9]{4}/[0-9]{2}/[0-9]{2}/E[0-9]{8}-[0-9]{3}/(submitted|approved)[.]pdf$'
    or name ~ '^purchase-resolution/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
    or name ~ '^work-order/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
  )
)
with check (
  bucket_id = 'nexus-documents'
  and (
    name ~ '^manufacturing/[0-9]{4}/[0-9]{2}/[0-9]{2}/PI-[0-9]{8}-[0-9]{2}/(submitted|approved)[.]pdf$'
    or name ~ '^purchase/[0-9]{4}/[0-9]{2}/[0-9]{2}/E[0-9]{8}-[0-9]{3}/(submitted|approved)[.]pdf$'
    or name ~ '^purchase-resolution/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
    or name ~ '^work-order/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
  )
);

drop policy if exists "nexus_documents_select_authenticated_or_room_participant" on storage.objects;
create policy "nexus_documents_select_authenticated_or_room_participant"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'nexus-documents'
  and (
    (
      name ~ '^manufacturing/[0-9]{4}/[0-9]{2}/[0-9]{2}/PI-[0-9]{8}-[0-9]{2}/(submitted|approved)[.]pdf$'
      or name ~ '^purchase/[0-9]{4}/[0-9]{2}/[0-9]{2}/E[0-9]{8}-[0-9]{3}/(submitted|approved)[.]pdf$'
      or name ~ '^purchase-resolution/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
      or name ~ '^work-order/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^/]+/(submitted|approved)[.]pdf$'
    )
    or exists (
      select 1
      from public.worktalk_files file
      where file.storage_bucket = 'nexus-documents'
        and file.storage_path = storage.objects.name
        and public.worktalk_can_view_room(file.room_id)
    )
  )
);

commit;
