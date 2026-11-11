-- =============================================================================
-- 20270312 · Estimates tab & funnel, session 6 — estimate events stay on the log
--            when the estimate has no customer account yet
-- =============================================================================
-- Brief: docs/briefs/claude-code-brief-estimates-tab-funnel.md, ruling E-L
-- (the estimate Activity panel reads crm_events once nothing it shows today
-- is lost). Ruled by Tom 11 Nov 2026: close the gaps, then switch.
--
-- The gap: crm_emit returned early on a null account, and so did both
-- estimate triggers. An estimate with no account wrote estimate_events
-- (sent, viewed, accepted, declined) and estimate_views, but nothing on the
-- log, so its Activity would have gone blank.
--
-- 1 · crm_emit keeps an event with no account when it names an estimate.
--     With neither an account nor an estimate it still drops it, as before.
-- 2 · estimates_crm_lifecycle writes its events for an accountless estimate
--     with a dedupe key ending :noacct. When an account is attached later
--     the trigger already re-emits under the plain keys (v_fresh), so the
--     account timeline gets its own copy; the estimate Activity merges the
--     two by type and time. Body otherwise identical to 20270219.
-- 3 · estimate_views_crm_lifecycle writes the open with no account.
--
-- Nothing reads these rows by account, so no timeline, facts row or queue
-- changes: crm_events_touch_facts and the first-touch trigger both skip a
-- null account already. No backfill: older accountless activity is read
-- from estimate_events in the Older activity fold of the estimate page.
-- =============================================================================

set lock_timeout = '15s';

-- ---- 1 · the internal emitter ----------------------------------------------------
create or replace function public.crm_emit(
  p_type text, p_account uuid, p_payload jsonb, p_source text, p_occurred timestamptz,
  p_estimate uuid, p_work_order uuid, p_invoice uuid, p_dedupe text
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- 20270312: an estimate event is kept without an account; anything else still needs one.
  if p_account is null and p_estimate is null then return; end if;
  if p_dedupe is not null and exists (select 1 from public.crm_events where dedupe_key = p_dedupe) then return; end if;
  begin
    insert into public.crm_events
      (account_id, estimate_id, work_order_id, invoice_id, type, source, payload, occurred_at, dedupe_key)
    values
      (p_account, p_estimate, p_work_order, p_invoice, p_type, coalesce(p_source, 'system'),
       coalesce(p_payload, '{}'::jsonb), coalesce(p_occurred, now()), p_dedupe);
  exception when unique_violation then
    null; -- lost a race on the dedupe key: the first writer row stands
  end;
end $$;
revoke all on function public.crm_emit(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---- 2 · the estimate lifecycle ---------------------------------------------------
create or replace function public.estimates_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fresh boolean := (tg_op = 'INSERT') or (old.account_id is null);
        v_total integer := coalesce(new.accepted_total_cents, new.total_cents, 0);
        -- 20270312: an accountless estimate writes under its own keys, so the
        -- account copy can still be written when an account is attached.
        v_k text := case when new.account_id is null then ':noacct' else '' end;
begin
  -- Import (20270152): the loader writes the historical events itself, with
  -- their real dates. Nothing here may stamp now() on a 2025 acceptance.
  if current_setting('crm.import', true) = 'on' then return new; end if;

  if (new.sent_at is not null or new.status in ('sent', 'accepted', 'declined', 'expired'))
     and (v_fresh or (old.sent_at is null and old.status = 'draft')) then
    perform public.crm_emit('estimate_sent', new.account_id,
      jsonb_build_object('totalCents', greatest(coalesce(new.total_cents, 0), 0), 'channel', 'link',
                         'validDays', case when new.valid_until is not null and new.sent_at is not null then greatest((new.valid_until - new.sent_at::date), 1) end),
      'system', coalesce(new.sent_at, new.created_at), new.id, null, null, 'estimate_sent:' || new.id || v_k);
  end if;

  if new.status = 'accepted' and (v_fresh or old.status is distinct from 'accepted') then
    perform public.crm_emit('estimate_accepted', new.account_id,
      jsonb_build_object('totalCents', greatest(v_total, 0)),
      'customer', coalesce(new.accepted_at, now()), new.id, null, null, 'estimate_accepted:' || new.id || v_k);
    -- Tom, 7 Oct 2026: a job accepted is a follow-up answered. The office
    -- reminder and any snooze on the customer go with it.
    if new.account_id is not null then
      update public.accounts
         set followup_due_at = null, followup_note = null, snoozed_until = null
       where id = new.account_id
         and (followup_due_at is not null or followup_note is not null or snoozed_until is not null);
    end if;
  end if;

  if new.status = 'declined' and (v_fresh or old.status is distinct from 'declined') then
    perform public.crm_emit('estimate_declined', new.account_id,
      case when nullif(trim(coalesce(new.declined_reason, '')), '') is null then '{}'::jsonb
           else jsonb_build_object('reason', left(new.declined_reason, 2000)) end,
      'customer', coalesce(new.declined_at, now()), new.id, null, null, 'estimate_declined:' || new.id || v_k);
  end if;

  if new.status = 'expired' and (v_fresh or old.status is distinct from 'expired') then
    perform public.crm_emit('estimate_lapsed', new.account_id,
      jsonb_build_object('totalCents', greatest(coalesce(new.total_cents, 0), 0),
                         'sentAt', new.sent_at, 'validUntil', new.valid_until),
      'system', now(), new.id, null, null, 'estimate_lapsed:' || new.id || v_k);
  end if;

  if new.viewed_at is not null and (v_fresh or old.viewed_at is null)
     and not exists (select 1 from public.estimate_views v where v.estimate_id = new.id) then
    perform public.crm_emit('estimate_viewed', new.account_id,
      jsonb_build_object('viewNumber', 1),
      'customer', new.viewed_at, new.id, null, null, 'estimate_viewed:' || new.id || ':first' || v_k);
  end if;

  return new;
end $$;

-- ---- 3 · estimate opens: one event per viewing session ------------------------------
create or replace function public.estimate_views_crm_lifecycle()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_n integer;
begin
  -- 20270312: an open is written whether or not the estimate has an account yet.
  select account_id into v_account from public.estimates where id = new.estimate_id;
  select count(*) into v_n from public.estimate_views where estimate_id = new.estimate_id and created_at <= new.created_at;
  perform public.crm_emit('estimate_viewed', v_account,
    jsonb_build_object('viewNumber', greatest(v_n, 1)),
    'customer', new.created_at, new.estimate_id, null, null,
    'estimate_viewed:' || new.estimate_id || ':' || new.session_id);
  return new;
end $$;

-- ---- read-back ------------------------------------------------------------------
-- Compare every value to its _expect_ neighbour before anything is called live.
select
  (select position('p_estimate is null' in prosrc) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_emit') as emit_keeps_estimate, true as _expect_emit_keeps_estimate,
  (select position(':noacct' in prosrc) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'estimates_crm_lifecycle') as lifecycle_noacct, true as _expect_lifecycle_noacct,
  (select position('v_account is null' in prosrc) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'estimate_views_crm_lifecycle') as views_no_guard, true as _expect_views_no_guard,
  has_function_privilege('authenticated', 'public.crm_emit(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text)', 'execute') as emit_auth, false as _expect_emit_auth,
  (select count(*) from pg_trigger where tgname in ('t_estimates_crm_lifecycle', 't_estimate_views_crm_lifecycle') and not tgisinternal) as triggers, 2 as _expect_triggers;

insert into public._prod_migrations(name) values ('20270312000000_estimate_events_without_account.sql') on conflict (name) do nothing;
