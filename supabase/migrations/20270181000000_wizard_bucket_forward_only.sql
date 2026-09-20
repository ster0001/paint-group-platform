-- =============================================================================
-- Wizard drafts · the bucket can never be written backwards past an outcome
--
-- 20 Sep 2026. CI #693 (PR #119) failed e2e/customer-journey/save-and-book:
-- a draft whose outcome was already `visit_requested` read `bucket =
-- 'online_now'`. The autosave route (app/api/wizard/draft) and the heartbeat
-- route read the row's outcome, compute the bucket in the app (lib/wizard/
-- journey.ts bucketFor) and write it back. When Save & book lands BETWEEN
-- that read and that write, the stale computation overwrites `ready_visit`
-- with `online_now` while the outcome column already says a visit was
-- requested. A later heartbeat repairs it — which is why the rows looked
-- right afterwards — but a person opening the CRM in that window sees a
-- lead in the wrong bucket, and the spec caught it.
--
-- The DB is the last line of defence: a BEFORE trigger derives the bucket
-- from the outcome whenever an action outcome is set, so NO writer — a
-- stale app read, a script, a hand edit — can file a customer who asked for
-- a call or a visit as merely "online now". The mapping is bucketFor's first
-- three lines, and lib/wizard/bucketTrigger.test.ts pins the two together.
--
-- Converges on a re-run (or replace / drop-first). Paste starts with a lock
-- timeout so a busy table fails loudly rather than deadlocking.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wizard_drafts_bucket_forward_only()
returns trigger
language plpgsql
as $$
begin
  -- brief §4: forward only on customer action (D→B→A). An action outcome
  -- decides the bucket outright; every other outcome leaves the app's answer.
  if new.outcome = 'call_requested' then
    new.bucket := 'ready_call';
  elsif new.outcome = 'visit_requested' then
    new.bucket := 'ready_visit';
  elsif new.outcome in ('question_asked', 'help_requested') then
    new.bucket := 'needs_help';
  end if;
  return new;
end;
$$;

drop trigger if exists wizard_drafts_bucket_forward_only on public.wizard_drafts;
create trigger wizard_drafts_bucket_forward_only
  before insert or update of bucket, outcome on public.wizard_drafts
  for each row execute function public.wizard_drafts_bucket_forward_only();

-- Heal any row the race already left behind (idempotent: a second run finds none).
update public.wizard_drafts
   set bucket = case outcome
                  when 'call_requested'  then 'ready_call'
                  when 'visit_requested' then 'ready_visit'
                  else 'needs_help'
                end
 where outcome in ('call_requested', 'visit_requested', 'question_asked', 'help_requested')
   and bucket not in ('ready_call', 'ready_visit', 'needs_help');

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from pg_trigger where tgname = 'wizard_drafts_bucket_forward_only' and not tgisinternal) as trigger_expect_1,
  (select count(*) from pg_proc where proname = 'wizard_drafts_bucket_forward_only')                       as function_expect_1,
  (select count(*) from public.wizard_drafts
     where outcome in ('call_requested', 'visit_requested', 'question_asked', 'help_requested')
       and bucket not in ('ready_call', 'ready_visit', 'needs_help'))                                        as regressed_rows_expect_0;

insert into public._prod_migrations(name) values ('20270181000000_wizard_bucket_forward_only.sql') on conflict (name) do nothing;
