-- NEXUS approval KST date fix
--
-- Purpose:
-- - Keep timestamptz values stored in UTC.
-- - Generate business dates and document/room number date parts by Asia/Seoul.
-- - Preserve the currently deployed function bodies and only replace unsafe current_date expressions.
-- - Do not modify existing documents, document numbers, or data rows.
--
-- Apply target:
-- - public.submit_approval_document(jsonb,jsonb,jsonb,jsonb)
-- - public.nexus_next_room_number(text)
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
--     'submit_approval_document',
--     'nexus_next_room_number',
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
  target_signature text;
  target_function regprocedure;
  source_sql text;
  patched_sql text;
  target_functions text[] := array[
    'public.submit_approval_document(jsonb,jsonb,jsonb,jsonb)',
    'public.nexus_next_room_number(text)',
    'public.nexus_finalize_manufacturing_submission(bigint)',
    'public.nexus_finalize_purchase_submission(bigint)',
    'public.nexus_finalize_work_order_submission(bigint)',
    'public.nexus_finalize_purchase_resolution_submission(bigint)'
  ];
begin
  foreach target_signature in array target_functions loop
    target_function := to_regprocedure(target_signature);

    if target_function is null then
      raise notice 'Function not found, skipped: %', target_signature;
      continue;
    end if;

    select pg_get_functiondef(target_function)
    into source_sql;

    patched_sql := source_sql;

    patched_sql := replace(
      patched_sql,
      'current_date::text',
      '(timezone(''Asia/Seoul'', now())::date)::text'
    );

    patched_sql := replace(
      patched_sql,
      'to_char(current_date, ''YYYYMMDD'')',
      'to_char(timezone(''Asia/Seoul'', now())::date, ''YYYYMMDD'')'
    );

    patched_sql := replace(
      patched_sql,
      'to_char(current_date, ''YY'')',
      'to_char(timezone(''Asia/Seoul'', now())::date, ''YY'')'
    );

    patched_sql := replace(
      patched_sql,
      'extract(year from current_date)::integer',
      'extract(year from timezone(''Asia/Seoul'', now())::date)::integer'
    );

    if patched_sql <> source_sql then
      execute patched_sql;
      raise notice 'Patched KST current_date usage in %', target_function::text;
    else
      raise notice 'No current_date patch needed for %', target_function::text;
    end if;
  end loop;
end $$;

commit;

-- Verification 1: function body, SECURITY DEFINER, search_path/function_config.
-- Normal result after apply:
-- - has_kst_date = true for functions that had unsafe date expressions.
-- - still_has_current_date = false for the 6 target functions.
-- - security_definer should remain true.
-- - function_config should include search_path=public where configured.
select
  p.oid::regprocedure as signature,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) like '%timezone(''Asia/Seoul'', now())::date%' as has_kst_date,
  pg_get_functiondef(p.oid) like '%current_date%' as still_has_current_date
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    to_regprocedure('public.submit_approval_document(jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.nexus_next_room_number(text)'),
    to_regprocedure('public.nexus_finalize_manufacturing_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_purchase_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_work_order_submission(bigint)'),
    to_regprocedure('public.nexus_finalize_purchase_resolution_submission(bigint)')
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Verification 2: routine execute privileges.
-- Normal result after apply:
-- - authenticated grants should remain for application-facing RPCs.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'submit_approval_document',
    'nexus_next_room_number',
    'nexus_finalize_manufacturing_submission',
    'nexus_finalize_purchase_submission',
    'nexus_finalize_work_order_submission',
    'nexus_finalize_purchase_resolution_submission'
  )
order by routine_name, grantee, privilege_type;

-- Verification 3: current UTC/KST date expressions.
-- Normal result:
-- - kst_date and kst_yyyymmdd should match the Korea business date.
select
  now() as utc_now,
  timezone('Asia/Seoul', now()) as kst_now,
  timezone('Asia/Seoul', now())::date as kst_date,
  to_char(timezone('Asia/Seoul', now())::date, 'YYYYMMDD') as kst_yyyymmdd,
  to_char(timezone('Asia/Seoul', now())::date, 'YY') as kst_yy;
