-- Sales opportunity parent/child linkage
-- Purpose:
-- - Treat follow-up sales reports as normal sales opportunities.
-- - Link a follow-up opportunity to an original opportunity with parent_id.
-- - Existing rows remain unchanged.

alter table public.sales_opportunities
add column if not exists parent_id bigint
references public.sales_opportunities(id)
on delete set null;

create index if not exists idx_sales_opportunities_parent_id
on public.sales_opportunities(parent_id);
