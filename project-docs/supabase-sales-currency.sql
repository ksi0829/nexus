begin;

alter table public.sales_opportunities
add column if not exists currency text not null default 'KRW';

update public.sales_opportunities
set currency = 'KRW'
where currency is null or currency = '';

commit;
