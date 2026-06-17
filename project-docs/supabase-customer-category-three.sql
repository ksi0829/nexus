begin;

alter table public.customers
  add column if not exists category text not null default 'customer';

update public.customers
set category = 'partner'
where category in ('processing', 'postprocess');

update public.customers
set category = 'other'
where category is null
   or category not in ('customer', 'partner', 'other');

alter table public.customers
  alter column category set default 'customer';

alter table public.customers
  drop constraint if exists customers_category_check;

alter table public.customers
  add constraint customers_category_check
  check (category in ('customer', 'partner', 'other'));

create index if not exists idx_customers_category_name
on public.customers (category, name);

commit;
