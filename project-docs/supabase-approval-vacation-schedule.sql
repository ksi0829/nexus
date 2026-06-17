begin;

create or replace function public.add_vacation_schedule_from_document(
  target_document_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  doc record;
  start_on date;
  end_on date;
  cursor_on date;
  applicant text;
  applicant_team text;
  vacation_type text;
  schedule_title text;
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  select *
  into doc
  from public.approval_documents
  where id = target_document_id;

  if not found or doc.template_key <> 'vacation_request' or doc.status <> 'approved' then
    return;
  end if;

  start_on := nullif(doc.form_data->>'startDate', '')::date;
  end_on := coalesce(nullif(doc.form_data->>'endDate', '')::date, start_on);
  applicant := coalesce(nullif(doc.form_data->>'applicant', ''), doc.requester_name, '휴가자');
  applicant_team := coalesce(nullif(doc.form_data->>'team', ''), doc.requester_team, '');
  vacation_type := coalesce(nullif(doc.form_data->>'vacationType', ''), '휴가');
  schedule_title := applicant || ' ' || vacation_type;

  if start_on is null then
    return;
  end if;

  if end_on < start_on then
    end_on := start_on;
  end if;

  cursor_on := start_on;
  while cursor_on <= end_on loop
    insert into public.schedules (
      date,
      time,
      type,
      company,
      title,
      writer,
      team,
      trip_id
    )
    select
      cursor_on::text,
      '',
      vacation_type,
      applicant,
      schedule_title,
      applicant,
      applicant_team,
      'approval_' || target_document_id::text
    where not exists (
      select 1
      from public.schedules s
      where s.date = cursor_on::text
        and coalesce(s.trip_id, '') = 'approval_' || target_document_id::text
    );

    cursor_on := cursor_on + 1;
  end loop;
end;
$fn$;

grant execute on function public.add_vacation_schedule_from_document(bigint) to authenticated;

do $backfill$
declare
  doc record;
  start_on date;
  end_on date;
  cursor_on date;
  applicant text;
  applicant_team text;
  vacation_type text;
  schedule_title text;
begin
  for doc in
    select *
    from public.approval_documents
    where template_key = 'vacation_request'
      and status = 'approved'
  loop
    start_on := nullif(doc.form_data->>'startDate', '')::date;
    end_on := coalesce(nullif(doc.form_data->>'endDate', '')::date, start_on);
    applicant := coalesce(nullif(doc.form_data->>'applicant', ''), doc.requester_name, '휴가자');
    applicant_team := coalesce(nullif(doc.form_data->>'team', ''), doc.requester_team, '');
    vacation_type := coalesce(nullif(doc.form_data->>'vacationType', ''), '휴가');
    schedule_title := applicant || ' ' || vacation_type;

    if start_on is not null then
      if end_on < start_on then
        end_on := start_on;
      end if;

      cursor_on := start_on;
      while cursor_on <= end_on loop
        insert into public.schedules (
          date,
          time,
          type,
          company,
          title,
          writer,
          team,
          trip_id
        )
        select
          cursor_on::text,
          '',
          vacation_type,
          applicant,
          schedule_title,
          applicant,
          applicant_team,
          'approval_' || doc.id::text
        where not exists (
          select 1
          from public.schedules s
          where s.date = cursor_on::text
            and coalesce(s.trip_id, '') = 'approval_' || doc.id::text
        );

        cursor_on := cursor_on + 1;
      end loop;
    end if;
  end loop;
end;
$backfill$;

commit;
