begin;

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
as $submit_approval_document$
declare
  requester uuid;
  new_document_id bigint;
  linked_order_id bigint;
  linked_stage_key text;
  form_payload jsonb;
  order_category text;
begin
  requester := auth.uid();
  form_payload := coalesce(document_payload->'form_data', '{}'::jsonb);
  linked_order_id := nullif(document_payload->>'equipment_order_id', '')::bigint;
  linked_stage_key := nullif(document_payload->>'equipment_stage_key', '');

  if requester is null then
    raise exception 'login required' using errcode = '28000';
  end if;

  insert into public.approval_documents (
    template_key,
    template_title,
    title,
    status,
    requester_id,
    requester_name,
    requester_team,
    current_step,
    form_data,
    equipment_order_id,
    equipment_stage_key
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
    form_payload,
    linked_order_id,
    linked_stage_key
  )
  returning id into new_document_id;

  if linked_stage_key = 'manufacturingRequest' and linked_order_id is null then
    order_category := case form_payload->>'orderCategory'
      when '해외 장비' then 'overseas'
      when '부품' then 'parts'
      else 'domestic'
    end;

    insert into public.equipment_orders (
      category,
      order_date,
      country,
      customer,
      model,
      owner_name,
      serial_no,
      delivery_place,
      note,
      shipment_scheduled_on,
      manufacturing_document_id,
      created_by
    )
    values (
      order_category,
      coalesce(nullif(form_payload->>'orderDate', ''), nullif(form_payload->>'createdDate', ''), current_date::text)::date,
      case when order_category = 'domestic' then null else nullif(form_payload->>'country', '') end,
      coalesce(nullif(form_payload->>'client', ''), nullif(form_payload->>'customer', ''), '고객사 미입력'),
      coalesce(nullif(form_payload->>'productName', ''), nullif(form_payload->>'equipment', ''), '모델 미입력'),
      coalesce(
        nullif(form_payload->>'owner', ''),
        nullif(form_payload->>'requester', ''),
        nullif(form_payload->>'applicant', ''),
        document_payload->>'requester_name',
        '담당자'
      ),
      nullif(form_payload->>'serialNo', ''),
      nullif(form_payload->>'deliveryPlace', ''),
      nullif(form_payload->>'reference', ''),
      nullif(form_payload->>'deliveryDate', '')::date,
      new_document_id,
      requester
    )
    returning id into linked_order_id;

    update public.approval_documents
    set
      equipment_order_id = linked_order_id,
      form_data = jsonb_set(form_data, '{_equipmentOrderId}', to_jsonb(linked_order_id), true)
    where id = new_document_id;
  elsif linked_order_id is not null and linked_stage_key = 'manufacturingRequest' then
    update public.equipment_orders
    set manufacturing_document_id = new_document_id
    where id = linked_order_id;
  elsif linked_order_id is not null and linked_stage_key = 'purchaseRequest' then
    update public.equipment_orders
    set purchase_document_id = new_document_id
    where id = linked_order_id;
  elsif linked_order_id is not null and linked_stage_key = 'qa' then
    update public.equipment_orders
    set qa_document_id = new_document_id
    where id = linked_order_id;
  end if;

  insert into public.approval_lines (
    document_id,
    step_order,
    role_label,
    approver_id,
    approver_name,
    approver_team,
    status
  )
  select
    new_document_id,
    x.step_order,
    x.role_label,
    x.approver_id,
    x.approver_name,
    x.approver_team,
    coalesce(x.status, 'pending')
  from jsonb_to_recordset(coalesce(line_payload, '[]'::jsonb)) as x(
    step_order integer,
    role_label text,
    approver_id uuid,
    approver_name text,
    approver_team text,
    status text
  );

  insert into public.approval_references (
    document_id,
    user_id,
    reference_name,
    reference_team
  )
  select
    new_document_id,
    x.user_id,
    x.reference_name,
    x.reference_team
  from jsonb_to_recordset(coalesce(reference_payload, '[]'::jsonb)) as x(
    user_id uuid,
    reference_name text,
    reference_team text
  );

  insert into public.approval_notifications (
    user_id,
    document_id,
    message
  )
  select
    x.user_id,
    new_document_id,
    x.message
  from jsonb_to_recordset(coalesce(notification_payload, '[]'::jsonb)) as x(
    user_id uuid,
    message text
  );

  return new_document_id;
end;
$submit_approval_document$;

grant execute on function public.submit_approval_document(jsonb, jsonb, jsonb, jsonb) to authenticated;

update public.equipment_orders eo
set manufacturing_document_id = d.id
from public.approval_documents d
where (
    eo.id = d.equipment_order_id
    or (
      d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$'
      and eo.id = (d.form_data->>'_equipmentOrderId')::bigint
    )
  )
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'manufacturingRequest'
  and eo.manufacturing_document_id is distinct from d.id;

update public.equipment_orders eo
set purchase_document_id = d.id
from public.approval_documents d
where (
    eo.id = d.equipment_order_id
    or (
      d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$'
      and eo.id = (d.form_data->>'_equipmentOrderId')::bigint
    )
  )
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'purchaseRequest'
  and eo.purchase_document_id is distinct from d.id;

update public.equipment_orders eo
set qa_document_id = d.id
from public.approval_documents d
where (
    eo.id = d.equipment_order_id
    or (
      d.form_data->>'_equipmentOrderId' ~ '^[0-9]+$'
      and eo.id = (d.form_data->>'_equipmentOrderId')::bigint
    )
  )
  and coalesce(d.equipment_stage_key::text, d.form_data->>'_equipmentStageKey') = 'qa'
  and eo.qa_document_id is distinct from d.id;

commit;
