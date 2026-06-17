begin;

create or replace function public.worktalk_send_files(
  target_room_id bigint,
  message_body text,
  attachment_rows jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, storage
as $function$
declare
  profile_row public.profiles%rowtype;
  attachment jsonb;
  new_message_id bigint;
  path_value text;
  name_value text;
  type_value text;
  size_value bigint;
begin
  if not public.worktalk_is_room_member(target_room_id) then
    raise exception 'Only room members may attach files.';
  end if;

  if attachment_rows is null
    or jsonb_typeof(attachment_rows) <> 'array'
    or jsonb_array_length(attachment_rows) < 1
    or jsonb_array_length(attachment_rows) > 5 then
    raise exception 'Attach between one and five files.';
  end if;

  select * into profile_row
  from public.profiles
  where id = auth.uid();

  insert into public.worktalk_messages (
    room_id,
    sender_id,
    sender_name,
    sender_team,
    message_type,
    body
  )
  values (
    target_room_id,
    auth.uid(),
    coalesce(profile_row.name, ''),
    profile_row.team,
    'file',
    coalesce(nullif(btrim(message_body), ''), '파일을 공유했습니다.')
  )
  returning id into new_message_id;

  for attachment in
    select value from jsonb_array_elements(attachment_rows)
  loop
    path_value := attachment ->> 'storage_path';
    name_value := attachment ->> 'original_name';
    type_value := attachment ->> 'mime_type';
    size_value := (attachment ->> 'size_bytes')::bigint;

    if path_value is null
      or path_value not like target_room_id::text || '/' || auth.uid()::text || '/%'
      or name_value is null
      or nullif(btrim(name_value), '') is null
      or size_value <= 0
      or size_value > 31457280 then
      raise exception 'Invalid WorkTalk attachment metadata.';
    end if;

    if not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'worktalk-files'
        and object.name = path_value
    ) then
      raise exception 'Uploaded WorkTalk file was not found.';
    end if;

    insert into public.worktalk_files (
      room_id,
      message_id,
      storage_path,
      original_name,
      mime_type,
      size_bytes,
      uploaded_by
    )
    values (
      target_room_id,
      new_message_id,
      path_value,
      name_value,
      nullif(type_value, ''),
      size_value,
      auth.uid()
    );
  end loop;

  update public.worktalk_rooms
  set last_message_at = now(), updated_at = now()
  where id = target_room_id;

  update public.worktalk_room_members
  set last_read_message_id = new_message_id, last_read_at = now()
  where room_id = target_room_id
    and user_id = auth.uid();

  return new_message_id;
end;
$function$;

grant execute on function public.worktalk_send_files(bigint, text, jsonb)
to authenticated;

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'worktalk_files'
  ) then
    alter publication supabase_realtime add table public.worktalk_files;
  end if;
end
$realtime$;

commit;
