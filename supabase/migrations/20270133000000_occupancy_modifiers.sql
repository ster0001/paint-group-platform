-- =============================================================================
-- Site and access: the occupancy modifiers (Tom, 9 September 2026)
--
-- Estimator journey v2 §4.4. Tom's own figures, and his approval to seed them:
--
--   empty or mostly empty  ≈ 2% of job value
--   furnished              ≈ 4% of job value
--
-- A modifier multiplies PAINTING HOURS (`priceSurface: paintingHr = base ×
-- jobMod`), so 2% is 1.02. They sit in the **Staging** group, which is the
-- group the lived-in-home modifier (STG-OCCUPIED) already uses — `jobModifier`
-- applies ONE selection per group, so occupancy can never compound with it
-- into a double allowance.
--
-- Deliberately NOT seeded here: hard/mixed floors (Tom prices it inside these
-- same figures), the stairwell (not allowed for today), tricky parking and a
-- lift booking. The last two do not scale with the job — carrying gear from a
-- side street costs the same two hours whether it is one room or ten — so they
-- are FLAT HOURS in lib/wizard/site-access.ts, not modifiers, and need no row.
--
-- Idempotent; read-back at the end. Tom tunes the multipliers afterwards in
-- Settings → Pricing → Modifiers without a deploy.
-- =============================================================================

insert into public.modifiers (code, group_name, label, multiplier, active)
select 'STG-EMPTY', 'Staging', 'Empty property', 1.02, true
 where not exists (select 1 from public.modifiers where code = 'STG-EMPTY');

insert into public.modifiers (code, group_name, label, multiplier, active)
select 'STG-PART-CLEARED', 'Staging', 'Mostly empty — some furniture stays', 1.02, true
 where not exists (select 1 from public.modifiers where code = 'STG-PART-CLEARED');

insert into public.modifiers (code, group_name, label, multiplier, active)
select 'STG-FURNISHED', 'Staging', 'Furnished — furniture stays throughout', 1.04, true
 where not exists (select 1 from public.modifiers where code = 'STG-FURNISHED');

-- ---- read-back ---------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.modifiers
   where code in ('STG-EMPTY', 'STG-PART-CLEARED', 'STG-FURNISHED');
  raise notice 'occupancy modifiers present: % of 3', n;
end $$;
