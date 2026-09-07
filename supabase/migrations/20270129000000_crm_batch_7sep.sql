-- CRM batch — Tom, 7 Sep 2026 (evening): items 3, 4, 5 and 9 of the sixteen.
--
--   3. `accounts.notify_prefs` — the customer's OWN alert settings from the
--      portal (which notification types, on which channels). Read by the send
--      layer (lib/messaging/send.ts) for every tagged customer send; a switched-
--      off send is recorded in `messages` as `suppressed`, never dropped silently.
--   4/5. `accounts.consents` — what the customer agreed to and where: project
--      communications (the wizard request) and marketing (the accept small
--      print). Provenance, not permission — permit_email / permit_sms stay the
--      switches the campaign guard reads; the accept path flips them to
--      `allowed` only from `unknown`, never over a `declined`.
--   9. Tags: Insurance job, Difficult access and Sydney partner go; Real estate
--      arrives. The three keys are stripped from every account and every cached
--      facts row so the filter never shows a ghost.
--
-- Idempotent. Read-back at the end.

alter table public.accounts add column if not exists notify_prefs jsonb not null default '{}'::jsonb;
alter table public.accounts add column if not exists consents jsonb not null default '{}'::jsonb;
comment on column public.accounts.notify_prefs is
  'Customer-set alert settings: {"<type>": {"email": bool, "sms": bool}} — unset means on. Types in lib/notifications/prefs.ts.';
comment on column public.accounts.consents is
  'What the customer agreed to and where: {"project": {"at","how"}, "marketing": {"at","how"}}. Provenance only — permit_* are the switches.';

-- A send the customer switched off is a recorded outcome, not an error.
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'not_configured', 'received', 'suppressed'));

-- ---- 9 · tags ----------------------------------------------------------------
update public.accounts
   set tags = array_remove(array_remove(array_remove(tags, 'insurance'), 'difficult_access'), 'sydney_partner')
 where tags && array['insurance', 'difficult_access', 'sydney_partner'];
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_account_facts' and column_name = 'tags') then
    update public.crm_account_facts
       set tags = array_remove(array_remove(array_remove(tags, 'insurance'), 'difficult_access'), 'sydney_partner')
     where tags && array['insurance', 'difficult_access', 'sydney_partner'];
  end if;
end $$;
delete from public.crm_tags where key in ('insurance', 'difficult_access', 'sydney_partner');
insert into public.crm_tags (key, label, sort_order) values ('real_estate', 'Real estate', 40)
  on conflict (key) do nothing;

-- ---- read-back ---------------------------------------------------------------
select
  exists (select 1 from information_schema.columns where table_name = 'accounts' and column_name = 'notify_prefs') as notify_prefs_ok,
  exists (select 1 from information_schema.columns where table_name = 'accounts' and column_name = 'consents') as consents_ok,
  (select count(*) from public.crm_tags where key in ('insurance', 'difficult_access', 'sydney_partner')) = 0 as old_tags_gone,
  exists (select 1 from public.crm_tags where key = 'real_estate') as real_estate_ok,
  (select count(*) from public.accounts where tags && array['insurance', 'difficult_access', 'sydney_partner']) = 0 as accounts_clean,
  (select pg_get_constraintdef(oid) like '%suppressed%' from pg_constraint where conname = 'messages_status_check') as suppressed_ok;
