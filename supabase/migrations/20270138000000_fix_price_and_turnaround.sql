-- =============================================================================
--  ███  PRODUCTION (llmrvgde…) AND the C1 TEST project (qarfyjrz…)
--       Run on BOTH. Check the editor's project name before pasting.
-- =============================================================================
--
-- C6 — fix, ask, visit. What a confirmation becomes when a person acts on it.
--
-- TWO THINGS THE BLOCK DID NOT ANTICIPATE, both small and both flagged:
--
-- 1. `properties.measured_tree`. C6's accept line is "the measured tree is
--    written on fix", and the column is listed against C15. Bringing it forward
--    rather than dropping the criterion: it is a planned column, not a new
--    idea, and C15 will find it already here. The whole point of §8.3 is that
--    the next quote on an address starts from what the last one measured — that
--    only works if something writes it, and fixing a price is the moment the
--    tree stops being a guess.
--
-- 2. A turnaround setting. C6 wants a warning card "when a request is older
--    than the turnaround setting", and no such setting existed — `turnaround`
--    was a string passed into handoffSteps. The hand-off screen PROMISES the
--    customer a turnaround, so the queue has to be measured against the same
--    number, from one place.
-- =============================================================================

alter table public.properties
  add column if not exists measured_tree jsonb;
comment on column public.properties.measured_tree is
  'The scope tree as an estimator confirmed it, written when a price is FIXED (C6). The seed for every later quick look on this address (§8.3) — a rebook should start from what the last job measured, not from scratch. Null until a person has signed off on a tree for this property.';

alter table public.properties
  add column if not exists measured_at timestamptz;
comment on column public.properties.measured_at is
  'When measured_tree was last written. A tree from two years ago is still worth seeding from, but the estimator should know its age.';

-- The turnaround we promise, in business hours. Settings-editable because the
-- hand-off screen says it out loud to the customer and the queue chases it —
-- two surfaces, one number, or we promise one thing and chase another.
insert into public.settings (key, value)
values ('confirmation_turnaround', '{"hours": 8, "words": "usually by the next working day"}'::jsonb)
on conflict (key) do nothing;

-- ---- read-back ----------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'properties'
         and column_name in ('measured_tree', 'measured_at')) <> 2 then
    raise exception 'read-back: properties.measured_tree / measured_at missing';
  end if;
  if not exists (select 1 from public.settings where key = 'confirmation_turnaround') then
    raise exception 'read-back: the confirmation_turnaround setting is missing';
  end if;
end $$;

-- Paste the result: expect 2 columns and the setting's value.
select column_name from information_schema.columns
 where table_schema='public' and table_name='properties' and column_name in ('measured_tree','measured_at')
union all
select value::text from public.settings where key='confirmation_turnaround';

-- PRODUCTION ONLY (the test project has no ledger):
insert into public._prod_migrations(name)
values ('20270138000000_fix_price_and_turnaround.sql')
on conflict (name) do nothing;
