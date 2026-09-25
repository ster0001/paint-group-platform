-- 25 Sep 2026 — Supabase Security Advisor: 2 errors + 742 warnings → 0 errors, ~40 warnings.
--
-- Everything here is a permission or catalogue change; no data moves, no function body changes.
-- Written to CONVERGE on a re-run, and every rule is data-driven where it can be so the same
-- paste is right on the test project and on production even though their function sets differ.
--
-- 1. security_definer_view (ERROR ×2) — wo_visible_jobs and customer_quote_lines run with the
--    owner's rights on purpose (a contractor may not read estimates/customers, a customer may
--    not read estimate_lines' cost columns). Nothing in app/, lib/ or e2e/ selects either view
--    through PostgREST: wo_visible_jobs is only referenced from nine wo_* RLS policies (by oid,
--    unaffected by a schema move) and customer_quote_lines is dead to the app (customers read
--    snapshots). So both move out of the API-exposed schema into `private`, which is what the
--    advisor asks for when definer semantics are intended. Policies still evaluate as the caller,
--    so authenticated keeps USAGE on the schema and SELECT on the view.
-- 2. function_search_path_mutable (WARN ×37) — every public function with no pinned search_path
--    gets `public, extensions` (the house style is `public`; `extensions` is added so a
--    bare gen_random_bytes() in a prod-only function keeps resolving). All 37 are SECURITY INVOKER.
-- 3. anon_security_definer_function_executable (WARN ×268) — the `anon` role is what a request
--    carries when it has NO session at all: the customer opening an /e/, /w/, /s/, /v/, /i/ or
--    /crew/ link. Those token RPCs, the RLS helper functions (is_staff, current_customer_id …)
--    and the two invite RPCs keep anon; every other definer function loses it, along with the
--    implicit PUBLIC grant Postgres adds by default. (Anonymous wizard sign-ins are the
--    `authenticated` role, not `anon`, so the wizard is untouched.)
-- 4. authenticated_security_definer_function_executable (WARN ×293) — revoked only where a
--    function is never named anywhere in app/, lib/, scripts/ or e2e/ (internal helpers that
--    other definer functions call, which run as the owner and need no grant) and from every
--    trigger function (fired by the trigger, never by a caller). Everything the app names by
--    string — including through run()/call() wrappers — keeps authenticated. The remaining
--    warnings are those RPCs, and they are meant to be callable by a signed-in user.
-- 5. Default privileges: new functions created by postgres in public no longer get EXECUTE for
--    PUBLIC/anon/authenticated. **Every future RPC grants what it needs explicitly** (CLAUDE.md).
-- 6. public_bucket_allows_listing (WARN ×7) — the seven public buckets each had a
--    `for select to public` policy on storage.objects. Public URLs and image transforms do not
--    consult policies; the only thing that policy enabled was listing and API download of the
--    whole bucket by anyone. Nothing in the app lists or downloads these buckets. Dropped.
--
-- NOT changed here (dashboard settings, need Tom): Leaked-password protection is OFF
-- (Auth → Attack Protection); anonymous sign-ins stay ON (the wizard needs them).

set lock_timeout = '15s';

-- ---- 1. definer views out of the API schema ------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;

do $$ begin
  if to_regclass('public.wo_visible_jobs') is not null then
    alter view public.wo_visible_jobs set schema private;
  end if;
  if to_regclass('public.customer_quote_lines') is not null then
    alter view public.customer_quote_lines set schema private;
  end if;
end $$;
grant select on private.wo_visible_jobs to authenticated, anon, service_role;
grant select on private.customer_quote_lines to authenticated, service_role;
revoke all on private.customer_quote_lines from anon;

-- ---- 2. pin search_path on every public function that has none -----------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;

-- ---- 3. anon: revoke from every definer function, grant back the token + helper set --------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and p.proname = any (array[
        'accept_estimate',
    'agent_is_my_conversation',
    'contractor_invite_preview',
    'current_contractor_id',
    'current_customer_id',
    'dashboard_sees_money',
    'decline_estimate',
    'estimate_changes_by_token',
    'get_estimate_by_token',
    'get_estimate_thread_by_token',
    'get_work_order_by_crew_token',
    'get_work_order_by_token',
    'get_work_order_office_photos_by_crew_token',
    'get_work_order_office_photos_by_token',
    'get_work_order_scope_changes_by_token',
    'get_work_order_ticks_by_crew_token',
    'get_work_order_ticks_by_token',
    'get_work_order_variations_by_crew_token',
    'invoice_by_token',
    'invoice_mark_viewed',
    'is_account_member',
    'is_employee',
    'is_owner',
    'is_staff',
    'post_estimate_message_by_token',
    'record_estimate_view',
    'record_work_order_view',
    'redeem_contractor_invite',
    'save_estimate_signature',
    'wo_customer_respond_variation',
    'wo_customer_sign_variation',
    'wo_my_job_ids_as_contractor',
    'wo_my_job_ids_as_customer',
    'wo_photo_access',
    'wo_prep_note_by_token',
    'wo_record_signoff_view',
    'wo_report_by_token',
    'wo_request_extension',
    'wo_sign',
    'wo_variation_by_token',
    'wo_walkthrough_area',
    'wo_walkthrough_by_token'
      ])
  loop
    execute format('grant execute on function %s to anon', r.sig);
  end loop;
end $$;

-- ---- 4. authenticated: trigger functions and internal-only helpers ---------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and (p.prorettype = 'trigger'::regtype or p.proname = any (array[
        'ask_estimate_question',
    'contractor_expense_sweep',
    'contractor_get_bank',
    'crm_audience_guard',
    'crm_emit',
    'crm_facts_touch',
    'invoice_event',
    'invoice_extend_due',
    'invoice_final_drift_cents',
    'invoice_ledger',
    'invoice_recompute_draft',
    'invoice_write_off',
    'invoice_write_snapshot_lines',
    'messages_emit_event',
    'save_settings_rows',
    'set_contractor_requires_qa',
    'timesheet_day_setting',
    'visits_guard',
    'wo_apply_variation_surfaces',
    'wo_approve_extension',
    'wo_assignment_conflict',
    'wo_cancel_variation_draft',
    'wo_seed_qa_items',
    'wo_set_stage',
    'wo_signoff_by_token',
    'wo_staff_confirm_variation',
    'wo_variation_apply_approval'
      ]))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
  -- Every other definer function keeps authenticated EXPLICITLY. Until now some relied on the
  -- implicit PUBLIC grant, which step 3 just removed; a prod-only function must not lose its
  -- callers because it was never named in a grant.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> all (array[
        'ask_estimate_question',
    'contractor_expense_sweep',
    'contractor_get_bank',
    'crm_audience_guard',
    'crm_emit',
    'crm_facts_touch',
    'invoice_event',
    'invoice_extend_due',
    'invoice_final_drift_cents',
    'invoice_ledger',
    'invoice_recompute_draft',
    'invoice_write_off',
    'invoice_write_snapshot_lines',
    'messages_emit_event',
    'save_settings_rows',
    'set_contractor_requires_qa',
    'timesheet_day_setting',
    'visits_guard',
    'wo_apply_variation_surfaces',
    'wo_approve_extension',
    'wo_assignment_conflict',
    'wo_cancel_variation_draft',
    'wo_seed_qa_items',
    'wo_set_stage',
    'wo_signoff_by_token',
    'wo_staff_confirm_variation',
    'wo_variation_apply_approval'
      ])
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ---- 5. future functions start closed ------------------------------------------------------
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- ---- 6. public buckets: no listing policy --------------------------------------------------
drop policy if exists campaign_media_read on storage.objects;
drop policy if exists contractor_logos_read on storage.objects;
drop policy if exists estimate_media_read on storage.objects;
drop policy if exists "presentation-docs_read" on storage.objects;
drop policy if exists "presentation-media_read" on storage.objects;
drop policy if exists product_photos_read on storage.objects;
drop policy if exists "showcase-media_read" on storage.objects;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce((select bool_or(o like 'security_invoker=%(true|on)') from unnest(c.reloptions) o), false)) as definer_views_in_api, 0 as _expect_definer_views_in_api,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname in ('wo_visible_jobs', 'customer_quote_lines')) as views_in_private, 2 as _expect_views_in_private,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) as unpinned_search_path, 0 as _expect_unpinned_search_path,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')) as anon_definer_fns, 42 as _expect_anon_definer_fns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')) as trigger_fns_callable, 0 as _expect_trigger_fns_callable,
  (select has_function_privilege('anon', 'public.get_estimate_by_token(text)', 'execute')) as token_page_still_works, true as _expect_token_page_still_works,
  (select has_function_privilege('authenticated', 'public.is_staff()', 'execute')) as rls_helper_still_works, true as _expect_rls_helper_still_works,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT' and roles = '{public}'
    and qual ~ '^\(bucket_id = ''[a-z-]+''::text\)$') as public_bucket_listing_policies, 0 as _expect_public_bucket_listing_policies;

insert into public._prod_migrations(name) values ('20270201000000_security_advisor_hardening.sql') on conflict (name) do nothing;
