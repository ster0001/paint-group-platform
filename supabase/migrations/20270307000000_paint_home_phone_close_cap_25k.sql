-- Paint Home phone-close ceiling: $25,000 (Tom, 27 Oct 2026, the too-big-to-price complaint).
-- Its own key, wizard_policy.paintHomeCapCents (lib/wizard/policy.ts); the office remote-confirmation cap
-- (remoteConfirmCapCents, $12,000, interior only) is not touched. Production reads the wizard_policy row
-- when one exists, so the key is written there too. Converges on a re-run.
set lock_timeout = '15s';

update public.settings
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{paintHomeCapCents}', '2500000'::jsonb, true)
 where key = 'wizard_policy';

-- read-back: _expect_ cap = 2500000 when a row exists (no row = the code default, also 2500000)
select key, value->>'paintHomeCapCents' as cap, value->>'remoteConfirmCapCents' as remote_cap_unchanged, 2500000 as _expect_cap
  from public.settings where key = 'wizard_policy';

insert into public._prod_migrations(name) values ('20270307000000_paint_home_phone_close_cap_25k.sql') on conflict (name) do nothing;
