-- NEXUS WorkTalk file attachment RLS fix
-- Apply this in the Supabase SQL Editor for the worklog project used by NEXUS.
--
-- Symptom:
--   Manufacturing PDF is generated/downloaded, but attaching it to the
--   WorkTalk room fails with:
--   "new row violates row-level security policy"
--
-- Cause:
--   worktalk_files has SELECT policy only. NEXUS document attachment RPCs insert
--   rows into worktalk_files after uploading PDFs to Storage.

grant insert, update on public.worktalk_files to authenticated;

drop policy if exists "worktalk_files_insert_room_member" on public.worktalk_files;
create policy "worktalk_files_insert_room_member"
on public.worktalk_files
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and public.worktalk_can_view_room(room_id)
  and exists (
    select 1
    from public.worktalk_messages message
    where message.id = worktalk_files.message_id
      and message.room_id = worktalk_files.room_id
  )
);

drop policy if exists "worktalk_files_update_uploader_or_privileged" on public.worktalk_files;
create policy "worktalk_files_update_uploader_or_privileged"
on public.worktalk_files
for update
to authenticated
using (
  uploaded_by = auth.uid()
  or public.worktalk_is_privileged()
)
with check (
  public.worktalk_can_view_room(room_id)
  and exists (
    select 1
    from public.worktalk_messages message
    where message.id = worktalk_files.message_id
      and message.room_id = worktalk_files.room_id
  )
);
