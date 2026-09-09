/**
 * The paint SYSTEM per surface group — coats and preparation DERIVED, never
 * asked (estimator journey v2 plan, §4.2; Tom's brief, 9 Sep 2026).
 *
 * The gap this closes (plan §2.2, "the single biggest accuracy gap"): coats
 * were chosen ONCE for the whole job, by the customer, from a card that said
 * "1 COAT / 2 COATS / 3 COATS" (app/wizard/WizardApp.tsx PageCondition), and
 * `coatsFor(tier, isDarkToLight)` stamped that one number onto every surface
 * in the tree. Coats differ BY SURFACE: new-colour walls need two, a
 * white-on-white ceiling usually needs one, enamel trims need two plus
 * preparation. A homeowner cannot judge that, and should never be asked to.
 *
 * So the customer answers two things they CAN judge — colour intent
 * ("same colours / new colours / going much lighter or bold") and overall
 * condition — and this module derives a system per surface group. The
 * customer then sees the result in the painter's own words on the paint-
 * systems screen and corrects any line with one tap.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHERE THE NUMBERS LIVE
 *
 * Every coat count below is a DEFAULT, not a constant: the whole table is a
 * `paint_systems` settings row, editable at Settings → Estimates → Paint
 * systems (⚑2 — "ship as Settings values; validate against worked hours in
 * against actuals"). This file holds the shape, the fallbacks and the
 * safety rules; Tom holds the numbers, exactly as he holds the rate card.
 *
 * ⚑ RULINGS APPLIED (plan §10, Tom 9 Sep — "use your suggestions, flag them")
 *   ⚑3 ceilings   one coat white-on-white; "they're marked" is the two-coat tap
 *   ⚑4 trims      two coats on a same-colour job; ONE only when condition is good.
 *                 NOTE: plan §4.2's table says "sand + 1 coat" for same-colour
 *                 trims, which contradicts ⚑4. ⚑4 is the later, explicit ruling
 *                 and is what ships. Flip `trims.same.coats` in Settings to
 *                 follow the table instead.
 *   ⚑5 gloss      asked on the systems screen, "not sure" the default; "yes"
 *                 adds a bonding primer, "not sure" routes to the estimator.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TWO RULES THAT ARE NOT TOM'S TO CHANGE (allowances spec §7.6, §7.3)
 *
 *  1. A single coat is only ever reachable when that surface is NOT changing
 *     colour. One coat over a colour change does not cover, and that is a
 *     warranty claim, not a saving. `enforceCoverage` below is the guard, and
 *     it overrides Settings — a mis-typed "1" in the walls/new cell cannot
 *     ship a job that will not cover. Note this is per SURFACE, not per job:
 *     a ceiling staying white on an otherwise new-colour job is not a colour
 *     change, which is why ⚑3's one coat is legitimate.
 *  2. Coats are EFFECTIVE LABOUR COATS (lib/pricing/types.ts ProductionLineInput):
 *     an undercoat or a bonding primer is expressed as +1 coat, priced by the
 *     rate card's own marginal-coat rule. This module never touches
 *     `coatMultiplier` or the card's 1-coat column — the "1.25 factor" in the
 *     allowances spec is already the card's `rate_1_coat`, and adding a second
 *     override on top would double-count it.
 */

import { z } from "zod";
import type { SubstrateKey } from "@/lib/estimate/substrates";

// ---------------------------------------------------------------------------
// The axes the customer actually answers
// ---------------------------------------------------------------------------

/**
 * Colour intent (plan §4.2) — asked ONCE, on the quick look.
 *
 * These are the three values the wizard already stores as
 * `condition.tier` = fresh | change | dark_to_light. The names change here
 * because "condition" was never what that answer meant: it is a colour
 * question wearing a condition label, which is part of why coats went wrong.
 * `colourIntentFromTier` maps the stored values across, so no snapshot,
 * seed or replay fixture has to be rewritten.
 */
export const COLOUR_INTENTS = ["same", "new", "bold"] as const;
export type ColourIntent = (typeof COLOUR_INTENTS)[number];

/** Overall condition (plan §4.3) — three bands, asked once on the quick look. */
export const CONDITION_BANDS = ["good", "wear", "work"] as const;
export type ConditionBand = (typeof CONDITION_BANDS)[number];

/** The surface groups the table is keyed on (plan §4.2). */
export const SYSTEM_GROUPS = ["walls", "ceilings", "trims", "doors", "windows"] as const;
export type SystemGroup = (typeof SYSTEM_GROUPS)[number];

/** The stored `condition.tier` → colour intent. */
export function colourIntentFromTier(tier: "fresh" | "change" | "dark_to_light"): ColourIntent {
  if (tier === "fresh") return "same";
  if (tier === "dark_to_light") return "bold";
  return "new";
}

/**
 * `details.damageTier` (0 none · 1 minor · 2 a few areas of concern · 3
 * desperate need) → the plan's three bands. 2 and 3 both mean "needs work":
 * the difference between them is how much prep, which is the band's hours,
 * not a different system.
 */
export function conditionBandFromDamageTier(tier: number): ConditionBand {
  if (tier <= 0) return "good";
  if (tier === 1) return "wear";
  return "work";
}

// ---------------------------------------------------------------------------
// Substrate → group
// ---------------------------------------------------------------------------

/**
 * Which group governs a substrate. `null` = this module has no opinion and
 * the caller keeps whatever coats it already had.
 *
 * EXTERIOR IS DELIBERATELY ABSENT. Plan §4.4 flags that per-elevation
 * exterior allowances do not exist yet (allowances spec §8 is unwritten), so
 * deriving exterior systems here would be inventing numbers nobody has
 * validated. Exterior surfaces fall through to the existing whole-job coats
 * until that spec lands. Cornices ride with ceilings (they are cut in on the
 * same pass, in the same tin); architraves and skirtings are trims; doors are
 * their own group only so the customer can see them named on the systems
 * screen — their defaults follow the trims row.
 */
export function groupForSubstrate(key: SubstrateKey | null | undefined): SystemGroup | null {
  switch (key) {
    case "walls": return "walls";
    case "ceilings": case "cornices": return "ceilings";
    case "skirting": case "architraves": return "trims";
    case "doors": return "doors";
    case "windows": return "windows";
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** One cell: what we do to this group for this colour intent. */
export type SystemRule = {
  /** Effective labour coats INCLUDING any undercoat (see rule 2 above). */
  coats: number;
  /** True when one of those coats is an undercoat/sealer rather than a topcoat. */
  undercoat: boolean;
  /** The customer-facing sentence, in the painter's words (plan §4.2). */
  sentence: string;
};

export type PaintSystems = {
  walls: Record<ColourIntent, SystemRule>;
  ceilings: Record<ColourIntent, SystemRule>;
  trims: Record<ColourIntent, SystemRule>;
  doors: Record<ColourIntent, SystemRule>;
  windows: Record<ColourIntent, SystemRule>;
  /** ⚑3 — the two-coat tap when the ceilings are marked or already coloured. */
  ceilingsMarkedCoats: number;
  /** ⚑4 — same-colour trims on a job in good condition. */
  trimsGoodConditionCoats: number;
  /** ⚑5 — a "yes" to the gloss question adds a bonding primer (+1 coat). */
  glossBondingPrimer: boolean;
  /**
   * Prep hours per unit of the rate item's own unit (m², lineal metre, item),
   * by condition band.
   *
   * DEFAULT ZERO, deliberately. Prep already reaches the tree by two routes
   * that are measured rather than assumed — `defect_prep_rates` via the
   * photo/defect pipeline (lib/extract/draft.ts) and the manual prep stepper —
   * and a non-zero default here would silently reprice every existing job the
   * moment this shipped. The band gets a HOME now; Tom sets the hours
   * against ACTUALS — work-order hours × charge-out plus materials (⚑2).
   * NOT against the proving window: it benchmarked the wizard against
   * PaintScout quotes that themselves lost money, so it is not a baseline to
   * set prices from (Tom, 8 and 9 Sep 2026).
   */
  prepHrPerUnit: Record<ConditionBand, number>;
};

/**
 * What a marked ceiling actually gets. Kept beside the table rather than in
 * it: it is the ⚑3 branch's sentence, not a fourth colour-intent column, and
 * it has to move whenever `ceilingsMarkedCoats` lifts the coats.
 */
export const MARKED_CEILINGS_SENTENCE =
  "White again, over the marks. We block the water marks and stains first so they can't ghost through, then two coats of flat ceiling white.";

const rule = (coats: number, undercoat: boolean, sentence: string): SystemRule => ({ coats, undercoat, sentence });

/**
 * The starting proposal from plan §4.2, with ⚑3/⚑4/⚑5 applied.
 *
 * Read the walls row against the acceptance criterion in plan §9.3 — "a
 * same-colour job and a new-colour job differ only in walls and trims": walls
 * 1→2, trims 2→3, doors follow trims 2→3, ceilings unchanged at 1, windows
 * unchanged at 2. That is the table's own proof it says what the plan meant.
 */
export const DEFAULT_PAINT_SYSTEMS: PaintSystems = {
  walls: {
    same: rule(1, false, "Same colour again. Fill nail holes and hairline cracks, light sand, spot-prime the fills, then one coat of low-sheen."),
    new: rule(2, false, "New colour. Fill nail holes and hairline cracks, light sand, spot-prime the fills, then two coats of low-sheen."),
    bold: rule(3, true, "Going much lighter, or a bold colour. Fill and sand, then a tinted undercoat and two coats of low-sheen."),
  },
  ceilings: {
    same: rule(1, false, "White again. One fresh coat of flat ceiling white over a sound surface."),
    new: rule(1, false, "White again. One fresh coat of flat ceiling white over a sound surface. Two if we're covering marks or a colour."),
    bold: rule(2, false, "A new ceiling colour. Two coats of flat ceiling paint."),
  },
  trims: {
    // ⚑4: two, not the §4.2 table's one. `trimsGoodConditionCoats` is the
    // "one only when condition is good" half of the same ruling.
    same: rule(2, false, "Same white. Sand and clean, fill any dents, then two coats of water-based enamel."),
    new: rule(3, true, "New colour. Sand and clean, fill any dents, then an undercoat and two coats of water-based enamel."),
    bold: rule(3, true, "New colour. Sand and clean, fill any dents, then an undercoat and two coats of water-based enamel."),
  },
  doors: {
    same: rule(2, false, "As the trims. Both sides, edges and frame — two coats of water-based enamel."),
    new: rule(3, true, "As the trims. Both sides, edges and frame — an undercoat and two coats of water-based enamel."),
    bold: rule(3, true, "As the trims. Both sides, edges and frame — an undercoat and two coats of water-based enamel."),
  },
  windows: {
    same: rule(2, false, "Sand back, then two coats to frames and sashes. Glass edges cut in by hand."),
    new: rule(2, false, "Sand and fill, then two coats to frames and sashes. Glass edges cut in by hand."),
    bold: rule(2, false, "Sand and fill, then two coats to frames and sashes. Glass edges cut in by hand."),
  },
  ceilingsMarkedCoats: 2,
  trimsGoodConditionCoats: 1,
  glossBondingPrimer: true,
  prepHrPerUnit: { good: 0, wear: 0, work: 0 },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const PAINT_SYSTEMS_KEY = "paint_systems";

/** Coats a person could plausibly mean. Anything else is a typo, not a system. */
const COATS_MIN = 1;
const COATS_MAX = 4;

const ruleSchema = z.object({
  coats: z.number().int().min(COATS_MIN).max(COATS_MAX),
  undercoat: z.boolean(),
  sentence: z.string().trim().min(1).max(400),
});

const intentsSchema = z.object({
  same: ruleSchema, new: ruleSchema, bold: ruleSchema,
});

export const paintSystemsSchema = z.object({
  walls: intentsSchema,
  ceilings: intentsSchema,
  trims: intentsSchema,
  doors: intentsSchema,
  windows: intentsSchema,
  ceilingsMarkedCoats: z.number().int().min(COATS_MIN).max(COATS_MAX),
  trimsGoodConditionCoats: z.number().int().min(COATS_MIN).max(COATS_MAX),
  glossBondingPrimer: z.boolean(),
  prepHrPerUnit: z.object({
    good: z.number().min(0).max(2),
    wear: z.number().min(0).max(2),
    work: z.number().min(0).max(2),
  }),
});

/**
 * The settings row → a complete table.
 *
 * Per-CELL fallback, not all-or-nothing: a row Tom has edited half of, or one
 * written before a group existed, keeps his edits and fills the rest from the
 * defaults. An unparseable cell falls back rather than throwing — a bad
 * settings value must never take the estimator down (the settings-folder
 * lesson, lib/settings/derived.ts).
 */
export function paintSystemsFrom(value: unknown): PaintSystems {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

  const cell = (group: SystemGroup, intent: ColourIntent): SystemRule => {
    const raw = (v[group] as Record<string, unknown> | undefined)?.[intent];
    const parsed = ruleSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_PAINT_SYSTEMS[group][intent];
  };
  const groupOf = (group: SystemGroup): Record<ColourIntent, SystemRule> => ({
    same: cell(group, "same"), new: cell(group, "new"), bold: cell(group, "bold"),
  });

  const int = (raw: unknown, fallback: number): number => {
    const n = z.number().int().min(COATS_MIN).max(COATS_MAX).safeParse(raw);
    return n.success ? n.data : fallback;
  };
  const hrs = (raw: unknown, fallback: number): number => {
    const n = z.number().min(0).max(2).safeParse(raw);
    return n.success ? n.data : fallback;
  };
  const prep = (v.prepHrPerUnit ?? {}) as Record<string, unknown>;

  return {
    walls: groupOf("walls"),
    ceilings: groupOf("ceilings"),
    trims: groupOf("trims"),
    doors: groupOf("doors"),
    windows: groupOf("windows"),
    ceilingsMarkedCoats: int(v.ceilingsMarkedCoats, DEFAULT_PAINT_SYSTEMS.ceilingsMarkedCoats),
    trimsGoodConditionCoats: int(v.trimsGoodConditionCoats, DEFAULT_PAINT_SYSTEMS.trimsGoodConditionCoats),
    glossBondingPrimer: typeof v.glossBondingPrimer === "boolean" ? v.glossBondingPrimer : DEFAULT_PAINT_SYSTEMS.glossBondingPrimer,
    prepHrPerUnit: {
      good: hrs(prep.good, DEFAULT_PAINT_SYSTEMS.prepHrPerUnit.good),
      wear: hrs(prep.wear, DEFAULT_PAINT_SYSTEMS.prepHrPerUnit.wear),
      work: hrs(prep.work, DEFAULT_PAINT_SYSTEMS.prepHrPerUnit.work),
    },
  };
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/** What the customer said, plus the three flags the systems screen collects. */
export type SystemAnswers = {
  colourIntent: ColourIntent;
  condition: ConditionBand;
  /**
   * ⚑5. "unsure" is the DEFAULT and is not a failure: it prices as "no"
   * (the common case) and sets `review`, so the estimator checks it rather
   * than the customer guessing. Old oil-based gloss under water-based enamel
   * is a common cause of a blown estimate — worth one screen, not a wrong
   * confident answer.
   */
  glossTrims?: "yes" | "no" | "unsure";
  /** ⚑3's tap. True = marked, or already a colour. */
  ceilingsMarked?: boolean;
  /**
   * The ceilings are getting a NEW colour rather than white again. Separate
   * from `colourIntent` on purpose: white-on-white is not a colour change,
   * which is what lets ⚑3's single coat past the coverage rule.
   */
  ceilingsChangingColour?: boolean;
  /**
   * This particular surface is going dark→light (the existing
   * `condition.darkToLightSurfaces` answer). Lifts the surface to `bold`
   * whatever the job-wide intent was.
   */
  darkToLight?: boolean;
};

export type PaintSystem = {
  group: SystemGroup;
  coats: number;
  undercoat: boolean;
  /** Prep hours per unit — multiply by the line's quantity. Usually 0; see above. */
  prepHrPerUnit: number;
  /** Plain English for the customer, on the paint-systems screen. */
  sentence: string;
  /** For the painter, on the work order. "" when there is nothing to add. */
  crewNote: string;
  /** True when a person must settle something before this price is sent. */
  review: boolean;
  /** Why the derived coats differ from the table cell, if they do. */
  reason: string;
};

/**
 * Allowances spec §7.6, enforced over Settings: one coat only where the
 * surface is not changing colour. Returns the coats actually safe to quote.
 */
function enforceCoverage(coats: number, changingColour: boolean): number {
  return coats < 2 && changingColour ? 2 : coats;
}

/**
 * The lookup. Pure: same answers in, same system out — no clock, no database,
 * no rate card. The rate card prices the result; this only decides what the
 * painter does.
 */
export function deriveSystem(
  group: SystemGroup,
  answers: SystemAnswers,
  systems: PaintSystems = DEFAULT_PAINT_SYSTEMS,
): PaintSystem {
  const intent: ColourIntent = answers.darkToLight ? "bold" : answers.colourIntent;
  const base = systems[group][intent];

  let coats = base.coats;
  let undercoat = base.undercoat;
  let sentence = base.sentence;
  let crewNote = "";
  let review = false;
  let reason = "";

  // ⚑3 — ceilings. The colour question is the ceiling's own, not the job's.
  const ceilingsChanging = group === "ceilings" && answers.ceilingsChangingColour === true;
  if (group === "ceilings") {
    if (answers.ceilingsMarked === true && systems.ceilingsMarkedCoats > coats) {
      coats = systems.ceilingsMarkedCoats;
      reason = "the ceilings are marked or already coloured";
      crewNote = "ceilings marked — stain-block the water marks before the topcoats";
      // The cell's sentence describes the ONE-coat system it was written for
      // ("One fresh coat of flat ceiling white"). Leaving it here put "2 coats"
      // in the heading above a sentence promising one — the card contradicting
      // itself, which is the exact failure it exists to prevent. Caught on the
      // real screen, 9 Sep.
      sentence = MARKED_CEILINGS_SENTENCE;
    }
  }

  // ⚑4 — "one only when condition is good", and only on a same-colour job.
  if (group === "trims" && intent === "same" && answers.condition === "good"
      && systems.trimsGoodConditionCoats < coats) {
    coats = systems.trimsGoodConditionCoats;
    reason = "the trims are in good condition and staying the same colour";
    sentence = "Same white, and they're sound. Sand and clean, fill any dents, then one coat of water-based enamel.";
  }

  // ⚑5 — the gloss question. A bonding primer is one more labour coat.
  const trimLike = group === "trims" || group === "doors";
  if (trimLike && systems.glossBondingPrimer) {
    if (answers.glossTrims === "yes") {
      coats += 1;
      undercoat = true;
      crewNote = "existing gloss is oil-based — bonding primer before the water-based enamel";
      reason = reason || "the existing trims are an oil-based gloss";
      sentence = `${sentence} A bonding primer first, because the existing gloss is oil-based.`;
    } else if (answers.glossTrims === "unsure" || answers.glossTrims == null) {
      // Priced as "no" — the common case — but a person confirms it.
      review = true;
      crewNote = "check on site whether the existing trim enamel is oil-based; bonding primer if it is";
    }
  }

  // Allowances spec §7.6 — the guard that overrides Settings.
  const changingColour = group === "ceilings" ? ceilingsChanging : intent !== "same";
  const safe = enforceCoverage(coats, changingColour);
  if (safe !== coats) {
    coats = safe;
    reason = "one coat will not cover a colour change";
  }

  return {
    group,
    coats,
    undercoat,
    prepHrPerUnit: systems.prepHrPerUnit[answers.condition],
    sentence,
    crewNote,
    review,
    reason,
  };
}

/**
 * The systems screen's body: one line per group that the job actually has
 * (plan §4.2, "the customer sees the result and corrects it with one tap
 * per line"). Groups with no ticked surface are left out — a line about
 * ceilings on a trims-only job is noise.
 */
export function systemsForSurfaces(
  surfaceKeys: ReadonlyArray<SubstrateKey>,
  answers: SystemAnswers,
  systems: PaintSystems = DEFAULT_PAINT_SYSTEMS,
): PaintSystem[] {
  const groups: SystemGroup[] = [];
  for (const key of surfaceKeys) {
    const g = groupForSubstrate(key);
    if (g != null && !groups.includes(g)) groups.push(g);
  }
  // Stable, and in the order a painter works: broad surfaces before joinery.
  groups.sort((a, b) => SYSTEM_GROUPS.indexOf(a) - SYSTEM_GROUPS.indexOf(b));
  return groups.map((g) => deriveSystem(g, answers, systems));
}
