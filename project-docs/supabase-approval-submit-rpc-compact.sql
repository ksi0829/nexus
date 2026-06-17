begin;

alter table public.equipment_orders
add column if not exists outsourcing_request_approved_on date;

alter table public.equipment_orders
add column if not exists outsourcing_document_id bigint;

do $$
declare
  constraint_name text;
begin
  select conname
  into constraint_name
  from pg_constraint
  where conrelid = 'public.approval_documents'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%equipment_stage_key%'
  limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.approval_documents drop constraint %I',
      constraint_name
    );
  end if;

  alter table public.approval_documents
  add constraint approval_documents_equipment_stage_key_check
  check (
    equipment_stage_key is null
    or equipment_stage_key in (
      'manufacturingRequest',
      'purchaseRequest',
      'outsourcingRequest',
      'qa'
    )
  );
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'equipment_orders_outsourcing_document_fk'
  ) then
    alter table public.equipment_orders
    add constraint equipment_orders_outsourcing_document_fk
    foreign key (outsourcing_document_id)
    references public.approval_documents(id)
    on delete set null;
  end if;
end $$;

create or replace function public.submit_approval_document(
  document_payload jsonb,
  line_payload jsonb,
  reference_payload jsonb default '[]'::jsonb,
  notification_payload jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  requester uuid := auth.uid();
  doc_id bigint;
  order_id bigint := nullif(document_payload->>'equipment_order_id', '')::bigint;
  stage_key text := nullif(document_payload->>'equipment_stage_key', '');
  f jsonb := coalesce(document_payload->'form_data', '{}'::jsonb);
  category text;
begin
  if requester is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  insert into approval_documents (
    template_key, template_title, title, status, requester_id, requester_name,
    requester_team, current_step, form_data, equipment_order_id, equipment_stage_key
  )
  values (
    document_payload->>'template_key',
    document_payload->>'template_title',
    document_payload->>'title',
    coalesce(document_payload->>'status', 'pending'),
    requester,
    coalesce(document_payload->>'requester_name', '작성자'),
    nullif(document_payload->>'requester_team', ''),
    coalesce((document_payload->>'current_step')::integer, 1),
    f,
    order_id,
    stage_key
  )
  returning id into doc_id;

  if stage_key = 'manufacturingRequest' and order_id is null then
    category := case f->>'orderCategory'
      when '해외 장비' then 'overseas'
      when '부품' then 'parts'
      else 'domestic'
    end;

    insert into equipment_orders (
      category, order_date, country, customer, model, owner_name, serial_no,
      delivery_place, note, shipment_scheduled_on, manufacturing_document_id, created_by
    )
    values (
      category,
      coalesce(nullif(f->>'orderDate', ''), nullif(f->>'createdDate', ''), current_date::text)::date,
      case when category = 'domestic' then null else nullif(f->>'country', '') end,
      coalesce(nullif(f->>'client', ''), nullif(f->>'customer', ''), '고객사 미입력'),
      coalesce(nullif(f->>'productName', ''), nullif(f->>'equipment', ''), '모델 미입력'),
      coalesce(nullif(f->>'owner', ''), nullif(f->>'requester', ''), nullif(f->>'applicant', ''), document_payload->>'requester_name', '담당자'),
      nullif(f->>'serialNo', ''),
      nullif(f->>'deliveryPlace', ''),
      nullif(f->>'reference', ''),
      nullif(f->>'deliveryDate', '')::date,
      doc_id,
      requester
    )
    returning id into order_id;

    update approval_documents
    set equipment_order_id = order_id,
        form_data = jsonb_set(form_data, '{_equipmentOrderId}', to_jsonb(order_id), true)
    where id = doc_id;
  elsif order_id is not null and stage_key = 'manufacturingRequest' then
    update equipment_orders set manufacturing_document_id = doc_id where id = order_id;
  elsif order_id is not null and stage_key = 'purchaseRequest' then
    update equipment_orders set purchase_document_id = doc_id where id = order_id;
  elsif order_id is not null and stage_key = 'outsourcingRequest' then
    update equipment_orders set outsourcing_document_id = doc_id where id = order_id;
  elsif order_id is not null and stage_key = 'qa' then
    update equipment_orders set qa_document_id = doc_id where id = order_id;
  end if;

  insert into approval_lines (document_id, step_order, role_label, approver_id, approver_name, approver_team, status)
  select doc_id, x.step_order, x.role_label, x.approver_id, x.approver_name, x.approver_team, coalesce(x.status, 'pending')
  from jsonb_to_recordset(coalesce(line_payload, '[]'::jsonb)) as x(step_order integer, role_label text, approver_id uuid, approver_name text, approver_team text, status text);

  insert into approval_references (document_id, user_id, reference_name, reference_team)
  select doc_id, x.user_id, x.reference_name, x.reference_team
  from jsonb_to_recordset(coalesce(reference_payload, '[]'::jsonb)) as x(user_id uuid, reference_name text, reference_team text);

  insert into approval_notifications (user_id, document_id, message)
  select x.user_id, doc_id, x.message
  from jsonb_to_recordset(coalesce(notification_payload, '[]'::jsonb)) as x(user_id uuid, message text);

  return doc_id;
end;
$fn$;

grant execute on function public.submit_approval_document(jsonb, jsonb, jsonb, jsonb) to authenticated;

update equipment_orders eo
set purchase_document_id = d.id
from approval_documents d
where eo.id = coalesce(d.equipment_order_id, case when d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$' then (d.form_data->>'_equipmentOrderId')::bigint end)
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'purchaseRequest'
  and eo.purchase_document_id is distinct from d.id;

update equipment_orders eo
set manufacturing_document_id = d.id
from approval_documents d
where eo.id = coalesce(d.equipment_order_id, case when d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$' then (d.form_data->>'_equipmentOrderId')::bigint end)
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'manufacturingRequest'
  and eo.manufacturing_document_id is distinct from d.id;

update equipment_orders eo
set qa_document_id = d.id
from approval_documents d
where eo.id = coalesce(d.equipment_order_id, case when d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$' then (d.form_data->>'_equipmentOrderId')::bigint end)
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'qa'
  and eo.qa_document_id is distinct from d.id;

update equipment_orders eo
set outsourcing_document_id = d.id
from approval_documents d
where eo.id = coalesce(d.equipment_order_id, case when d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$' then (d.form_data->>'_equipmentOrderId')::bigint end)
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'outsourcingRequest'
  and eo.outsourcing_document_id is distinct from d.id;

commit;
