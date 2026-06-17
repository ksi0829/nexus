begin;

grant select, insert, update, delete on public.approval_documents to authenticated;
grant select, insert, update, delete on public.approval_lines to authenticated;
grant select, insert, delete on public.approval_references to authenticated;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'approval_documents'
      and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.approval_documents', policy_name);
  end loop;
end $$;

create policy "approval_documents_insert_authenticated"
on public.approval_documents
for insert
to authenticated
with check (true);

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'approval_lines'
      and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.approval_lines', policy_name);
  end loop;
end $$;

create policy "approval_lines_insert_authenticated"
on public.approval_lines
for insert
to authenticated
with check (true);

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'approval_references'
      and cmd = 'INSERT'
  loop
    execute format('drop policy if exists %I on public.approval_references', policy_name);
  end loop;
end $$;

create policy "approval_references_insert_authenticated"
on public.approval_references
for insert
to authenticated
with check (true);

commit;
