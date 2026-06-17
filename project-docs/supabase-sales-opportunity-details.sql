-- ZETA sales opportunity report details
-- Adds a long-form report body while preserving the existing item/title field.

alter table public.sales_opportunities
add column if not exists details text not null default '';

comment on column public.sales_opportunities.details is
'Detailed sales report content shown in the sales detail view and PDF report.';
