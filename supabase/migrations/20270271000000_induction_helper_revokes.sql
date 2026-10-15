-- 20270271 · Induction helpers: no session may call them directly
--
-- The 20270270 read-back on production showed gate_callable_by_session = true: the
-- definer helpers that the induction RPCs call (the gate rule, the kind, the modules of
-- a kind, the tick and completion tests) were executable by any signed-in user, because
-- a function created without an explicit grant keeps whatever PUBLIC held on that
-- project. They answer about ANY login by id, so a painter could ask about another.
-- The rule (CLAUDE.md): a helper other definer functions call gets NO grant. This file
-- says so explicitly for every one of them. The four RPCs a session is meant to call
-- (induction_status, induction_statuses, induction_ack_module, induction_check_record,
-- induction_invite, induction_set_kind, induction_publish_version) keep their grants.
-- Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

revoke all on function public.induction_required_version() from public, anon, authenticated;
revoke all on function public.induction_kind_of(uuid) from public, anon, authenticated;
revoke all on function public.induction_modules_for(text) from public, anon, authenticated;
revoke all on function public.induction_tasks_for(text) from public, anon, authenticated;
revoke all on function public.induction_module_ticked(uuid, text) from public, anon, authenticated;
revoke all on function public.induction_completed_at(uuid) from public, anon, authenticated;
revoke all on function public.induction_check_passed(uuid) from public, anon, authenticated;
revoke all on function public.induction_gate_of(uuid) from public, anon, authenticated;
revoke all on function public.induction_worker_maybe_induct(uuid) from public, anon, authenticated;
revoke all on function public.induction_status_of(uuid) from public, anon, authenticated;

-- ---- read-back: every column false, every RPC still callable ----------------------------
select
  has_function_privilege('authenticated', 'public.induction_gate_of(uuid)', 'execute') as gate_by_session, false as _expect_gate_by_session,
  has_function_privilege('authenticated', 'public.induction_status_of(uuid)', 'execute') as status_of_by_session, false as _expect_status_of_by_session,
  has_function_privilege('authenticated', 'public.induction_completed_at(uuid)', 'execute') as completed_by_session, false as _expect_completed_by_session,
  has_function_privilege('anon', 'public.induction_kind_of(uuid)', 'execute') as kind_by_anon, false as _expect_kind_by_anon,
  has_function_privilege('authenticated', 'public.induction_status(uuid)', 'execute') as status_rpc, true as _expect_status_rpc,
  has_function_privilege('authenticated', 'public.induction_ack_module(text, text)', 'execute') as ack_rpc, true as _expect_ack_rpc,
  has_function_privilege('authenticated', 'public.induction_check_record(uuid, text, text, text)', 'execute') as check_rpc, true as _expect_check_rpc;

insert into public._prod_migrations(name) values ('20270271000000_induction_helper_revokes.sql') on conflict (name) do nothing;
