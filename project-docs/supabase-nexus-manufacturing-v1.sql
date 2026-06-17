begin;

alter table public.approval_documents
  add column if not exists document_no text,
  add column if not exists worktalk_room_id bigint references public.worktalk_rooms(id) on delete set null,
  add column if not exists previous_document_id bigint references public.approval_documents(id) on delete set null;

create unique index if not exists approval_documents_document_no_unique
  on public.approval_documents (document_no) where document_no is not null;

create or replace function public.nexus_finalize_manufacturing_submission(target_document_id bigint)
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

  if document_row.document_no is not null and document_row.worktalk_room_id is not null then
    return jsonb_build_object('document_no', document_row.document_no, 'room_id', document_row.worktalk_room_id);
  end if;

  perform pg_advisory_xact_lock(hashtext('NEXUS-PI-' || current_date::text));
  select coalesce(max(right(document_no, 2)::integer), 0) + 1
  into next_sequence
  from public.approval_documents
  where document_no like 'PI-' || to_char(current_date, 'YYYYMMDD') || '-__';

  generated_no := 'PI-' || to_char(current_date, 'YYYYMMDD') || '-' || lpad(next_sequence::text, 2, '0');
  select * into requester_profile from public.profiles where id = auth.uid();

  select count(*) into fixed_profile_count
  from public.profiles
  where name in ('장동철','신영호','신훈식','신상민');

  if fixed_profile_count <> 4 then
    raise exception 'NEXUS manufacturing approver/reference profiles are incomplete.';
  end if;

  delete from public.approval_lines where document_id = target_document_id;
  insert into public.approval_lines (
    document_id, step_order, role_label, approver_id, approver_name, approver_team, status
  )
  select
    target_document_id,
    case profile.name when '장동철' then 1 else 2 end,
    case profile.name when '장동철' then '1차 결재' else '2차 최종 결재' end,
    profile.id,
    profile.name,
    profile.team,
    'pending'
  from public.profiles profile
  where profile.name in ('장동철','신영호')
  order by case profile.name when '장동철' then 1 else 2 end;

  delete from public.approval_references where document_id = target_document_id;
  insert into public.approval_references (
    document_id, user_id, reference_name, reference_team
  )
  select target_document_id, profile.id, profile.name, profile.team
  from public.profiles profile
  where profile.name in ('신훈식','신상민');

  insert into public.worktalk_rooms (room_type, title, created_by)
  values ('approval', '[제조요구서] ' || document_row.title, auth.uid())
  returning id into new_room_id;

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  values (new_room_id, auth.uid(), 'owner');

  insert into public.worktalk_room_members (room_id, user_id, member_role)
  select
    new_room_id,
    profile.id,
    case when profile.name in ('신훈식','신상민') then 'viewer' else 'member' end
  from public.profiles profile
  where profile.name in ('장동철','신영호','신훈식','신상민')
    and profile.id <> auth.uid()
  on conflict (room_id, user_id) do nothing;

  insert into public.worktalk_messages (
    room_id, sender_id, sender_name, sender_team, message_type, body, metadata
  )
  values (
    new_room_id,
    auth.uid(),
    coalesce(requester_profile.name, document_row.requester_name),
    requester_profile.team,
    'document',
    coalesce(requester_profile.name, document_row.requester_name) || '님이 ' ||
      document_row.title || '에 대한 제조요구서를 상신합니다.',
    jsonb_build_object('approval_document_id', document_row.id, 'document_no', generated_no)
  )
  returning id into new_message_id;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = new_room_id;

  update public.approval_documents
  set document_no = generated_no,
      worktalk_room_id = new_room_id,
      form_data = jsonb_set(form_data, '{documentNo}', to_jsonb(generated_no), true)
  where id = target_document_id;

  return jsonb_build_object(
    'document_no', generated_no,
    'room_id', new_room_id,
    'message_id', new_message_id
  );
end;
$function$;

grant execute on function public.nexus_finalize_manufacturing_submission(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
