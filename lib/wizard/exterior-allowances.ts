import type { WizardDeferred } from "./view";

/**
 * Exterior access allowances — the per-elevation half of the allowances spec
 * (§8), which has never been written. Plan §4.4 and §9.7 both stop here, and
 * it is why `groupForSubstrate` returns nothing for exterior and why the
 * exterior quick look was never built.
 *
 * ⚑ WHERE THESE NUMBERS CAME FROM. Tom asked for a recommendation rather than
 * supplying figures ("I'll take your advice", 9 Sep) and **accepted them as the
 * starting point on 10 Sep**. They are therefore agreed, not guessed — but they
 * are still UNMEASURED, which is a different thing. Every one is a Settings
 * value under `exterior_access_hours` and every job that uses one is FLAGGED,
 * so fifty jobs of work-order actuals can correct them without a deploy. That
 * is the mechanism Tom agreed to, and it is the part that matters: the numbers
 * are a starting point with a correction path, not a decision nobody can revisit.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY HOURS AND NOT MULTIPLIERS — the same argument that rebuilt site access.
 *
 * A second storey does not make paint go on more slowly. It makes you set up,
 * move, reset and pack down ladders or a tower, and that cost is the same
 * whether the wall above it is 6 m or 16 m long. A percentage would
 * under-price the small awkward elevation it hurts most and over-price the
 * big straightforward one.
 *
 * Same for ground conditions. A steep or narrow side is a planking and
 * footing problem — setup, not painting rate.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY SCAFFOLD IS ALWAYS A VARIATION, WITH NO THRESHOLD.
 *
 * Tom asked whether there is a point at which we absorb it. There should not
 * be. A threshold means the estimate quietly carries a cost nobody priced,
 * on exactly the jobs where that cost is largest and least predictable —
 * which is the single most reliable way an exterior job loses money. Quoting
 * it honestly as an add-on once somebody has seen the site is both cheaper
 * and easier to defend. So scaffold produces an EXCLUSION and a flag here,
 * never hours, and the customer-facing line already says so.
 */

/** One allowance, as a line the customer and the painter both read. */
export type ExteriorAllowance = {
  key: string;
  label: string;
  hours: number;
  /** What the painter is told. */
  note: string;
};

export type ExteriorAllowanceSettings = {
  /**
   * Per SIDE that has an upper level to reach. Setup, moving and packing down
   * a tower or extension ladders — not painting rate.
   */
  upperStoreyPerSide: number;
  /**
   * Per SIDE flagged steep or tight. Planks, footings, and carrying gear the
   * long way round.
   */
  difficultGroundPerSide: number;
};

/** Agreed with Tom 10 Sep as a starting point. Settings-editable; correct them
 *  against work-order actuals rather than treating them as measured. */
export const DEFAULT_EXTERIOR_ALLOWANCES: ExteriorAllowanceSettings = {
  upperStoreyPerSide: 2,
  difficultGroundPerSide: 1.5,
};

export const EXTERIOR_ALLOWANCES_KEY = "exterior_access_hours";

/** The Settings value → a complete object; anything unusable falls back. */
export function exteriorAllowancesFrom(value: unknown): ExteriorAllowanceSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 40 ? x : fallback;
  return {
    upperStoreyPerSide: num(v.upperStoreyPerSide, DEFAULT_EXTERIOR_ALLOWANCES.upperStoreyPerSide),
    difficultGroundPerSide: num(v.difficultGroundPerSide, DEFAULT_EXTERIOR_ALLOWANCES.difficultGroundPerSide),
  };
}

/** Everything the exterior answers imply about getting to the work. */
export type ExteriorAccessInput = {
  storeys: "single" | "double" | string;
  /** The ticked ground/height conditions. */
  access: ReadonlyArray<"steep" | "tight" | "high" | string>;
  /** Ticked equipment. Scaffold is the one that changes the quote's shape. */
  accessEquipment: ReadonlyArray<"scissor_lift" | "boom_lift" | "scaffold" | string>;
  /** How many sides are actually being painted — the allowances are per side. */
  sidesPainted: number;
};

export type ExteriorAccessOutcome = {
  /** Flat-hour lines to add to the job. */
  allowances: ExteriorAllowance[];
  /** Named on the quote as NOT included, in the customer's words. */
  exclusions: string[];
  /** Amber notes for the estimator. `areaId` is always stated (never left
   *  undefined) so these drop straight into the merge bundle's own list. */
  deferred: Array<WizardDeferred & { areaId: number | null }>;
};

/** The customer-facing exclusion, worded once so every surface agrees. */
export const SCAFFOLD_EXCLUSION =
  "Scaffolding or a lift isn't included. If the job needs one we'll price it "
  + "with you before we start, as a separate line — never a surprise on the invoice.";

export function exteriorAccessAllowances(
  input: ExteriorAccessInput,
  settings: ExteriorAllowanceSettings = DEFAULT_EXTERIOR_ALLOWANCES,
): ExteriorAccessOutcome {
  const allowances: ExteriorAllowance[] = [];
  const exclusions: string[] = [];
  const deferred: ExteriorAccessOutcome["deferred"] = [];
  // A job with no sides being painted (fence or deck only) has no elevation
  // to reach, so none of this applies — charging setup for walls nobody is
  // painting is the kind of line that loses a quote.
  const sides = Math.max(0, Math.floor(input.sidesPainted));

  const upper = input.storeys === "double" || input.access.includes("high");
  if (upper && sides > 0 && settings.upperStoreyPerSide > 0) {
    const hours = round2(settings.upperStoreyPerSide * sides);
    allowances.push({
      key: "upper_storey",
      label: `Working at height — ${sides} ${sides === 1 ? "elevation" : "elevations"}`,
      hours,
      note: `Set-up, moving and pack-down for the upper level on ${sides} `
        + `${sides === 1 ? "side" : "sides"} (${settings.upperStoreyPerSide} h each).`,
    });
  }

  const difficult = input.access.includes("steep") || input.access.includes("tight");
  if (difficult && sides > 0 && settings.difficultGroundPerSide > 0) {
    // Deliberately NOT per flagged side: the customer ticks conditions for the
    // whole property, not side by side, so the honest reading is one
    // allowance across the job rather than four guesses.
    const hours = round2(settings.difficultGroundPerSide);
    allowances.push({
      key: "difficult_ground",
      label: "Awkward ground to work off",
      hours,
      note: input.access.includes("steep")
        ? "Sloping ground — planks and footings before anything gets painted."
        : "Tight side access — gear carried in, and less room to stand a ladder.",
    });
  }

  /**
   * Equipment. NOTHING here is priced, and that is the decision, not an
   * omission (Tom, 29 Aug set the same rule for hire and delivery). A ticked
   * item also makes the job non-straightforward, which the policy ladder
   * already reads as `requires_site_check`.
   */
  if (input.accessEquipment.length > 0) {
    exclusions.push(SCAFFOLD_EXCLUSION);
    deferred.push({
      room: "Whole job",
      areaId: null,
      count: 1,
      kind: "exterior_access_equipment",
      what: "access equipment",
      needs: `the customer expects ${input.accessEquipment.map(equipmentWord).join(", ")}. `
        + "Price the hire, delivery and set-up as its own line before the price is fixed — "
        + "nothing for it is in this estimate.",
    });
  }

  /**
   * ⚑ Every allowance applied is flagged, once, with the numbers named. They
   * are my proposal and not Tom's, so an estimator must be able to see that a
   * job carries them and say whether they were right — that feedback is how
   * these become real numbers.
   */
  if (allowances.length > 0) {
    const total = round2(allowances.reduce((n, a) => n + a.hours, 0));
    deferred.push({
      room: "Whole job",
      areaId: null,
      count: 1,
      kind: "exterior_access_allowance",
      what: "exterior access allowance",
      needs: `${total} h allowed for getting to the work `
        + `(${allowances.map((a) => `${a.label.toLowerCase()} ${a.hours} h`).join(", ")}). `
        + "These are provisional figures — check them against the hours the job actually took, "
        + "and set the real ones in Settings → Estimates → Exterior access.",
    });
  }

  return { allowances, exclusions, deferred };
}

function equipmentWord(k: string): string {
  return k === "scaffold" ? "scaffolding" : k === "boom_lift" ? "a boom lift" : k === "scissor_lift" ? "a scissor lift" : k;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
