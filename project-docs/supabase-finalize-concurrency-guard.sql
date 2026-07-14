-- NEXUS finalize RPC concurrency guard
--
-- Purpose:
-- - Prevent duplicate document number/room creation when the same approval document
--   is finalized more than once at nearly the same time.
-- - Patch the currently deployed function bodies in place by adding FOR UPDATE to
--   the target approval_documents row lookup.
-- - Preserve SECURITY DEFINER, search_path, return type, grants, and the current
--   deployed function logic.
--
-- Target functions:
-- - public.nexus_finalize_manufacturing_submission(bigint)
-- - public.nexus_finalize_purchase_submission(bigint)
-- - public.nexus_finalize_work_order_submission(bigint)
-- - public.nexus_finalize_purchase_resolution_submission(bigint)
--
-- Before applying, run and save this backup query result.
-- If rollback is needed, copy each function_sql value and execute it again.
--
-- select
--   p.oid::regprocedure as signature,
--   p.prosecdef as security_definer,
--   p.proconfig as function_config,
--   pg_get_functiondef(p.oid) as function_sql
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in (
--     'nexus_finalize_manufacturing_submission',
--     'nexus_finalize_purchase_submission',
--     'nexus_finalize_work_order_submission',
--     'nexus_finalize_purchase_resolution_submission'
--   )
-- order by p.proname, pg_get_function_identity_arguments(p.oid);
--
-- Rollback:
-- 1. Use the saved function_sql output above.
-- 2. Execute each original CREATE OR REPLACE FUNCTION statement.
-- 3. Re-run the verification queries at the end of this file.

begin;

do $$
declare
  target record;
  target_function regprocedure;
  source_sql text;
  patched_sql text;
  lookup_pattern text;
  locked_pattern text;
begin
  for target in
    select *
    from (
      values
        (
          'public.nexus_finalize_manufacturing_submission(bigint)',
          'manufacturing_request'
        ),
        (
          'public.nexus_finalize_purchase_submission(bigint)',
          'purchase_request'
        ),
        (
          'public.nexus_finalize_work_order_submission(bigint)',
          'work_order'
        ),
        (
          'public.nexus_finalize_purchase_resolution_submission(bigint)',
          'purchase_resolution'
        )
    ) as target_functions(signature_text, template_key)
  loop
    target_function := to_regprocedure(target.signature_text);

    if target_function is null then
      raise exception 'Function not found: %', target.signature_text;
    end if;

    select pg_get_functiondef(target_function)
    into source_sql;

    lookup_pattern :=
      '(from public\.approval_documents[[:space:]]+' ||
      'where id = target_document_id[[:space:]]+' ||
      'and requester_id = auth\.uid\(\)[[:space:]]+' ||
      'and template_key = ''' || target.template_key || ''')[[:space:]]*;';

    locked_pattern :=
      'from public\.approval_documents[[:space:]]+' ||
      'where id = target_document_id[[:space:]]+' ||
      'and requester_id = auth\.uid\(\)[[:space:]]+' ||
      'and template_key = ''' || target.template_key || '''[[:space:]]+' ||
      'for update[[:space:]]*;';

    patched_sql := regexp_replace(
      source_sql,
      lookup_pattern,
      E'\\1\n  for update;'
    );

    if patched_sql = source_sql then
      if source_sql ~ locked_pattern then
        raise notice 'FOR UPDATE already exists in %, skipped.', target_function::text;
        continue;
      end if;

      raise exception 'Could not safely patch approval_documents lookup in %', target_function::text;
    end if;

    execute patched_sql;
    raise notice 'Added FOR UPDATE to %', target_function::text;
  end loop;
end $$;

commit;

-- Verification 1: row-lock presence and idempotency order.
-- Normal result after apply:
-- - has_for_update = true
-- - lock_before_idempotency = true
select
  p.oid::regprocedure as signature,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) ~ (
    'from public\.approval_documents[[:space:]]+' ||
    'where id = target_document_id[[:space:]]+' ||
    'and requester_id = auth\.uid\(\)[[:space:]]+' ||
    'and template_key = ''' ||
    case p.proname
      when 'nexus_finalize_manufacturing_submission' then 'manufacturing_request'
      when 'nexus_finalize_purchase_submission' then 'purchase_request'
      when 'nexus_finalize_work_order_submission' then 'work_order'
      when 'nexus_finalize_purchase_resolution_submission' then 'purchase_resolution'
    end ||
    '''[[:space:]]+for update[[:space:]]*;'
  ) as has_for_update,
  position('for update' in lower(pg_get_functiondef(p.oid))) > 0
    and position('if document_row.document_no is not null' in lower(pg_get_functiondef(p.oid))) > 0
    and position('for update' in lower(pg_get_functiondef(p.oid)))
      < position('if document_row.document_no is not null' in lower(pg_get_functiondef(p.oid)))
    as lock_before_idempotency
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.nexus_finalize_manufacturing_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_purchase_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_work_order_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_purchase_resolution_submission(bigint)')
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Verification 2: routine execute privileges.
-- Normal result after apply:
-- - authenticated grants should remain.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'nexus_finalize_manufacturing_submission',
    'nexus_finalize_purchase_submission',
    'nexus_finalize_work_order_submission',
    'nexus_finalize_purchase_resolution_submission'
  )
order by routine_name, grantee, privilege_type;

-- Verification 3: current KST date expressions still present.
-- Normal result:
-- - has_kst_date = true for functions that generate KST business dates.
-- - still_has_current_date = false for these finalize functions after the KST patch.
select
  p.oid::regprocedure as signature,
  pg_get_functiondef(p.oid) like '%timezone(''Asia/Seoul'', now())::date%' as has_kst_date,
  pg_get_functiondef(p.oid) like '%current_date%' as still_has_current_date
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.nexus_finalize_manufacturing_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_purchase_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_work_order_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_purchase_resolution_submission(bigint)')
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Optional manual concurrency test outline, do not run on production data directly:
-- 1. Create one test approval document with pending document_no/worktalk_room_id.
-- 2. In two SQL editor sessions as the same requester, call:
--      select public.nexus_finalize_purchase_submission(<same_test_document_id>);
-- 3. Expected:
--      - nexus_document_sequences.last_value increases once.
--      - approval_documents.document_no is set once.
--      - one approval worktalk room is created.
--      - one document message exists for approval_document_id.
--      - both calls return the same document_no, room_id, and message_id.
-- 4. Clean up only the explicitly created test document/room/files after verification.
