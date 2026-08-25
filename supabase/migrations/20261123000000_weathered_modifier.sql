-- ============================================================================
-- Weathered re-ruled ×1.2 (Tom, 25 Aug 2026).
--
-- EXT-WEATHERED was seeded ×1.8 on 20 Aug (20260922) — a whole-job labour
-- multiplier that priced "chalky or faded in places" HEAVIER than
-- "Poor — flaking/peeling" (×1.35) and Heritage (×1.7). One click jumped a
-- job by ~80% of all labour. Re-ruled to ×1.2: above Fair (×1.0), below
-- Poor (×1.35), matching the chip's own wording ("extra preparation
-- allowed for"). Genuinely flaking jobs use Poor; the wizard's "Peeling"
-- answer already routes to staff review.
--
-- Idempotent; safe to re-run. Ends with a read-back (house law).
-- ============================================================================

update public.modifiers
   set multiplier = 1.2
 where code = 'EXT-WEATHERED';

-- Read-back — expect: EXT-WEATHERED · Weathered exterior · 1.2 · true
select code, label, multiplier, active
  from public.modifiers
 where code = 'EXT-WEATHERED';
