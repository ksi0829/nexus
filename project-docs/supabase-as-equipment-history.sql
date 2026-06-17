begin;

alter table public.as_work_orders
  add column if not exists equipment_order_id bigint references public.equipment_orders(id) on delete set null,
  add column if not exists serial_no text;

create index if not exists idx_as_work_orders_equipment_order_id
on public.as_work_orders (equipment_order_id);

create index if not exists idx_as_work_orders_serial_no
on public.as_work_orders (serial_no);

update public.as_work_orders awo
set serial_no = eo.serial_no
from public.equipment_orders eo
where awo.equipment_order_id = eo.id
  and nullif(awo.serial_no, '') is null
  and nullif(eo.serial_no, '') is not null;

commit;
