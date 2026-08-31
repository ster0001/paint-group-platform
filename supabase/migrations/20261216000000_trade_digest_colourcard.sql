-- =============================================================================
-- Trade portal v2 · Session 6 — digest tracking + the colour card's
-- where-to-buy line (Tom's rulings ⚑7/⚑11, 31 Aug).
--
--   ⚑11 digest defaults are ROLE-derived app-side (admin/approver ON at
--   17:00, finance/viewer OFF), so notification_prefs stays a sparse
--   override table: digest_enabled NULL = the role default, true/false =
--   the person's own choice. last_digest_at powers "only send when
--   something happened since the last one" — no empty digests.
--
--   ⚑7 the colour card PDF's "where to buy" line is one Settings value
--   (brand + nearest trade centre/retailer), edited office-side. Never a
--   trade account number, never trade pricing — the card carries no money
--   by construction (colour_records has no price columns).
-- =============================================================================

alter table public.notification_prefs
  add column if not exists digest_enabled boolean,
  add column if not exists last_digest_at timestamptz;

comment on column public.notification_prefs.digest_enabled is
  'NULL = role default (admin/approver on, finance/viewer off). ⚑11.';
comment on column public.notification_prefs.last_digest_at is
  'The previous digest send — a digest only goes out when in-scope events exist after this.';

insert into public.settings (key, value)
select 'colour_card', '{"whereToBuy": ""}'::jsonb
where not exists (select 1 from public.settings where key = 'colour_card');

-- ---- read-backs (CLAUDE.md law) --------------------------------------------

-- Expect: both columns
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'notification_prefs'
  and column_name in ('digest_enabled', 'last_digest_at')
order by column_name;

-- Expect: one colour_card row
select key, value from public.settings where key = 'colour_card';
