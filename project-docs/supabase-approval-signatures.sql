-- NEXUS approval signature image support
-- Apply this once in Supabase SQL editor before using signature images in PDFs.

alter table public.profiles
  add column if not exists signature_image_path text,
  add column if not exists signature_updated_at timestamptz;

grant update (signature_image_path, signature_updated_at)
on public.profiles
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'approval-signatures',
  'approval-signatures',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "approval_signatures_read_authenticated" on storage.objects;
create policy "approval_signatures_read_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'approval-signatures');

drop policy if exists "approval_signatures_insert_admin" on storage.objects;
drop policy if exists "approval_signatures_insert_own_or_admin" on storage.objects;
create policy "approval_signatures_insert_own_or_admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'approval-signatures'
  and (
    name = 'signatures/' || auth.uid()::text || '/signature.png'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);

drop policy if exists "approval_signatures_update_admin" on storage.objects;
drop policy if exists "approval_signatures_update_own_or_admin" on storage.objects;
create policy "approval_signatures_update_own_or_admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'approval-signatures'
  and (
    name = 'signatures/' || auth.uid()::text || '/signature.png'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
)
with check (
  bucket_id = 'approval-signatures'
  and (
    name = 'signatures/' || auth.uid()::text || '/signature.png'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);

drop policy if exists "approval_signatures_delete_admin" on storage.objects;
drop policy if exists "approval_signatures_delete_own_or_admin" on storage.objects;
create policy "approval_signatures_delete_own_or_admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'approval-signatures'
  and (
    name = 'signatures/' || auth.uid()::text || '/signature.png'
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
);

drop policy if exists "profiles_update_own_signature" on public.profiles;
create policy "profiles_update_own_signature"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and (
    signature_image_path is null
    or signature_image_path = 'signatures/' || id::text || '/signature.png'
  )
);
