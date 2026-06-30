-- WorkTalk diagnostics read access for the temporary test user.
-- Run this in the Supabase SQL Editor only when Kim Seonil needs to compare
-- app-side slow-message latency with public.worktalk_send_message_diagnostics.
--
-- This does not change the user's role and does not grant any admin feature.
-- It only permits SELECT on the send-message diagnostics table.

drop policy if exists "worktalk_send_message_diag_admin_select"
on public.worktalk_send_message_diagnostics;

create policy "worktalk_send_message_diag_admin_select"
on public.worktalk_send_message_diagnostics
for select
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and (
        profile.role = 'admin'
        or profile.name = '김선일'
      )
  )
);

grant select on public.worktalk_send_message_diagnostics to authenticated;
