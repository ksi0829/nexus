begin;

create table if not exists public.customer_equipments (
  id bigserial primary key,
  customer_id bigint references public.customers(id) on delete set null,
  customer_name text not null default '',
  model text not null default '',
  serial_no text not null default '',
  delivered_on date,
  location text not null default '',
  contact_name text not null default '',
  contact_phone text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.as_work_orders
  add column if not exists customer_equipment_id bigint references public.customer_equipments(id) on delete set null,
  add column if not exists serial_no text;

alter table public.customer_equipments
  add column if not exists note text not null default '';

alter table public.customer_equipments enable row level security;

grant select, insert, update, delete on public.customer_equipments to authenticated;
grant usage, select on sequence public.customer_equipments_id_seq to authenticated;

drop policy if exists "customer_equipments_select_authenticated_all" on public.customer_equipments;
drop policy if exists "customer_equipments_insert_admin" on public.customer_equipments;
drop policy if exists "customer_equipments_update_admin" on public.customer_equipments;
drop policy if exists "customer_equipments_delete_admin" on public.customer_equipments;

create policy "customer_equipments_select_authenticated_all"
on public.customer_equipments
for select
to authenticated
using (true);

create policy "customer_equipments_insert_admin"
on public.customer_equipments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "customer_equipments_update_admin"
on public.customer_equipments
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "customer_equipments_delete_admin"
on public.customer_equipments
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create index if not exists idx_customer_equipments_customer_id
on public.customer_equipments (customer_id);

create index if not exists idx_customer_equipments_serial_no
on public.customer_equipments (serial_no);

create index if not exists idx_as_work_orders_customer_equipment_id
on public.as_work_orders (customer_equipment_id);

commit;
