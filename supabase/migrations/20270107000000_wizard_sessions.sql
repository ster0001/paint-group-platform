-- =============================================================================
-- Wizard progress, estimate status and CRM buckets
-- (docs/briefs/wizard-progress-crm-buckets.md, 6 Sep 2026)
--
-- The brief's `wizard_sessions` IS `wizard_drafts`: one row per wizard start,
-- keyed on the anonymous auth user (the brief's session_token), created on
-- the first autosave. A second table for the same run would be the
-- single-source violation the CRM rules forbid, so the session columns are
-- added here instead. The lead/stage/task side is DERIVED (lib/crm/stage.ts,
-- lib/crm/work-queue.ts) — the only stored classification is `bucket`,
-- denormalised for list views exactly as §2.1 asks, written by the autosave,
-- the outcome routes and the 30-minute sweep (§4.3).
--
-- RLS is unchanged: staff read/write; the customer reaches their own row only
-- through the wizard's routes (service client + ownership by user_id).
-- Idempotent; read-back at the end.
-- =============================================================================

alter table public.wizard_drafts
  -- §2.1 mode + entry source (the CRM lead source, verbatim) + the typed address
  add column if not exists mode text
    constraint wizard_drafts_mode_check check (mode is null or mode in ('home', 'business')),
  add column if not exists entry_source text
    constraint wizard_drafts_entry_source_shape check (entry_source is null or (entry_source ~ '^[a-z_]+(:[a-z0-9-]+)?$' and length(entry_source) <= 100)),
  add column if not exists address text
    constraint wizard_drafts_address_len check (address is null or length(address) <= 250),
  -- where they are / got to (wizard pages are numbered; labels live in lib/wizard/journey.ts)
  add column if not exists current_page integer not null default 1
    constraint wizard_drafts_current_page_range check (current_page between 1 and 12),
  add column if not exists furthest_page integer not null default 1
    constraint wizard_drafts_furthest_page_range check (furthest_page between 1 and 12),
  add column if not exists pages_total integer not null default 6
    constraint wizard_drafts_pages_total_range check (pages_total between 1 and 12),
  -- §3 the last customer action
  add column if not exists outcome text not null default 'none'
    constraint wizard_drafts_outcome_check check (outcome in ('none', 'call_requested', 'visit_requested', 'question_asked', 'help_requested')),
  add column if not exists outcome_at timestamptz,
  add column if not exists outcome_note text
    constraint wizard_drafts_outcome_note_len check (outcome_note is null or length(outcome_note) <= 2000),
  -- §2.3 attention, not wall-clock: 15 s per heartbeat, per page
  add column if not exists active_seconds integer not null default 0
    constraint wizard_drafts_active_nonneg check (active_seconds >= 0),
  add column if not exists step_times jsonb not null default '{}'::jsonb
    constraint wizard_drafts_step_times_object check (jsonb_typeof(step_times) = 'object'),
  add column if not exists last_heartbeat_at timestamptz,
  -- §4.3 set by the sweep, never by the client
  add column if not exists dropped_at timestamptz,
  -- §4 the CRM bucket, denormalised for list views
  add column if not exists bucket text not null default 'online_now'
    constraint wizard_drafts_bucket_check check (bucket in ('online_now', 'ready_call', 'ready_visit', 'needs_help', 'dropped', 'priced_no_request'));

comment on column public.wizard_drafts.bucket is 'CRM bucket (brief §4): online_now | ready_call | ready_visit | needs_help | dropped | priced_no_request. Recomputed by lib/wizard/journey.ts bucketFor on every write; the sweep moves online_now → dropped / priced_no_request after 45 idle minutes.';
comment on column public.wizard_drafts.step_times is '{"<page number>": seconds} — 15 s per heartbeat while the tab is visible and the person has typed or scrolled in the last minute.';

create index if not exists wizard_drafts_bucket_idx    on public.wizard_drafts (bucket, last_seen_at desc);
create index if not exists wizard_drafts_sweep_idx     on public.wizard_drafts (last_seen_at) where bucket = 'online_now';
create index if not exists wizard_drafts_estimate_idx  on public.wizard_drafts (estimate_id) where estimate_id is not null;
create index if not exists wizard_drafts_dropped_idx   on public.wizard_drafts (dropped_at desc) where dropped_at is not null;

-- ---- read-back ---------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wizard_drafts'
        and column_name in ('mode','entry_source','address','current_page','furthest_page','pages_total','outcome','outcome_at',
                            'outcome_note','active_seconds','step_times','last_heartbeat_at','dropped_at','bucket')) <> 14 then
    raise exception 'read-back: wizard_drafts session columns missing';
  end if;
  if (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'wizard_drafts'
        and indexname in ('wizard_drafts_bucket_idx','wizard_drafts_sweep_idx','wizard_drafts_estimate_idx','wizard_drafts_dropped_idx')) <> 4 then
    raise exception 'read-back: wizard_drafts session indexes missing';
  end if;
end $$;

-- Paste the result in chat: expect 14 rows.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'wizard_drafts'
   and column_name in ('mode','entry_source','address','current_page','furthest_page','pages_total','outcome','outcome_at',
                       'outcome_note','active_seconds','step_times','last_heartbeat_at','dropped_at','bucket')
 order by 1;
