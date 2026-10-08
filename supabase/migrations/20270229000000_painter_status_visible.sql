-- Painter status, Step 6 (brief ⚑21): the painter-facing switch, enforced in
-- the database. settings.painter_status_rules.statusVisibleToPainters (default
-- true) decides whether a painter can read their own painter_status and
-- painter_job_results rows at all. Off = the rows do not exist for them, so no
-- screen, no card, no text (the server render shows nothing, not CSS hiding).
-- Staff reads are unchanged. Converges on a re-run.
set lock_timeout = '15s';

create or replace function public.painter_status_visible()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'statusVisibleToPainters')::boolean from public.settings where key = 'painter_status_rules'), true);
$$;
revoke all on function public.painter_status_visible() from public, anon;
grant execute on function public.painter_status_visible() to authenticated;

drop policy if exists painter_status_own on public.painter_status;
create policy painter_status_own on public.painter_status for select to authenticated
  using (painter_id = public.current_contractor_id() and public.painter_status_visible());

drop policy if exists painter_job_results_own on public.painter_job_results;
create policy painter_job_results_own on public.painter_job_results for select to authenticated
  using (painter_id = public.current_contractor_id() and public.painter_status_visible());

-- ---- read-back: compare to the _expect_ columns before calling this live ------
select
  has_function_privilege('authenticated', 'public.painter_status_visible()', 'execute') as visible_grant, true as _expect_grant,
  (select count(*) from pg_policies where schemaname = 'public' and policyname in ('painter_status_own', 'painter_job_results_own')
     and qual like '%painter_status_visible%') as gated_policies, 2 as _expect_gated,
  public.painter_status_visible() as visible_now, true as _expect_visible;

insert into public._prod_migrations(name) values ('20270229000000_painter_status_visible.sql') on conflict (name) do nothing;
