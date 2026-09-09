/**
 * Site and access — plan §4.4, prototype screen 9.
 *
 * The gap this closes (plan §2.4): interior access was never asked at all, so
 * the things that decide how long protection and packing down take had no
 * bearing on the price.
 *
 * ────────────────────────────────────────────────────────────────────────
 * REBUILT 9 SEP 2026 ON TOM'S ACTUAL NUMBERS — AND MULTIPLIERS WERE WRONG
 *
 * The first cut made all six answers modifier multipliers, which was the
 * wrong shape twice over. Tom's own figures:
 *
 *   · empty or mostly empty      ≈ 2% of job value
 *   · furnished                  ≈ 4% of job value
 *   · hard or mixed floors       NOT factored — it is already inside the
 *                                empty/furnished prep
 *   · stairwell or void          not allowed for today
 *   · tricky parking             ≈ 2–3 HOURS
 *   · lift access                ≈ 1 HOUR
 *
 * Two different shapes, and only one of them is a multiplier:
 *
 *   OCCUPANCY scales with the job — a furnished six-bedroom takes more
 *   covering than a furnished flat — so it is a percentage, which is what a
 *   modifier already is (`paintingHr = base × jobMod`).
 *
 *   PARKING and a LIFT BOOKING do not scale with the job at all. Carrying
 *   gear from a side street costs the same two hours whether it is one room
 *   or ten. A percentage would under-price the small job it hurts most and
 *   over-price the big one. They are FLAT HOURS.
 *
 * And two questions are gone: floors, because Tom does not price it
 * separately, and pricing it here would double-count the occupancy
 * allowance; and the stairwell, which is now a note for the estimator rather
 * than a question that changes nothing.
 */

import type { WizardDeferred } from "./view";

/** The stored answers. Every one optional — an unanswered screen costs nothing. */
export type SiteAccess = {
  /** Empty · mostly empty · furniture stays. The occupancy allowance. */
  cleared?: "yes" | "some" | "no";
  /**
   * Kept in the type so a stored answer from before 9 Sep still parses, and
   * deliberately NOT priced: Tom's floors allowance lives inside the
   * empty/furnished figure, and charging it again here would double-count.
   */
  floors?: "carpet" | "hard" | "mixed";
  stairwell?: "yes" | "no";
  parking?: "drive" | "street" | "hard";
  /** Units and apartments only — a house never sees it. */
  lift?: "yes" | "no";
  pets?: "yes" | "no";
};

/**
 * The occupancy allowance, as a multiplier on painting hours.
 *
 * Tom's percentages, expressed the way `jobModifier` consumes them. They live
 * in the Staging group, which is the group the lived-in-home modifier already
 * uses — ONE selection per group, so they can never compound with it.
 */
export const OCCUPANCY_MODIFIERS: Record<NonNullable<SiteAccess["cleared"]>, { code: string; pct: number }> = {
  yes: { code: "STG-EMPTY", pct: 2 },
  some: { code: "STG-PART-CLEARED", pct: 2 },
  no: { code: "STG-FURNISHED", pct: 4 },
};

export const STAGING_GROUP = "Staging";

/** A flat hours allowance — the cost that does not scale with the job. */
export type HourAllowance = {
  key: string;
  /** The line the customer and the painter both read. */
  label: string;
  hours: number;
  /** What the painter is told. */
  note: string;
};

/**
 * Tom's hours, 9 Sep. Settings-editable like everything else that decides
 * money — `site_access_hours`, below.
 */
export const DEFAULT_HOUR_ALLOWANCES: Record<string, HourAllowance> = {
  "parking:hard": {
    key: "parking:hard",
    label: "Difficult parking — carrying gear in and out",
    hours: 2.5,
    note: "no parking at the door — allow time carrying gear in and out each day",
  },
  "lift:yes": {
    key: "lift:yes",
    label: "Lift and building booking",
    hours: 1,
    note: "book the lift and work to the building's hours",
  },
};

export const SITE_ACCESS_HOURS_KEY = "site_access_hours";

/** The settings row → the hour allowances, per-entry fallback. */
export function hourAllowancesFrom(value: unknown): Record<string, HourAllowance> {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out: Record<string, HourAllowance> = {};
  for (const [key, def] of Object.entries(DEFAULT_HOUR_ALLOWANCES)) {
    const raw = v[key] as { hours?: unknown } | undefined;
    const hours = typeof raw?.hours === "number" && raw.hours >= 0 && raw.hours <= 40 ? raw.hours : def.hours;
    out[key] = { ...def, hours };
  }
  return out;
}

export type SiteAccessOutcome = {
  /** Modifier selections to merge into the estimate's `modSel`. */
  modSel: Record<string, string>;
  /** Flat-hour lines to put on the job. */
  hours: HourAllowance[];
  /** Notes for the estimator and the painter that carry no price. */
  notes: string[];
  /** Raised only when a priced answer has no modifier row to price it. */
  deferred: WizardDeferred[];
};

/**
 * Answers → what they cost.
 *
 * The occupancy modifier still follows the rule `applyConditionPricing` set:
 * use Tom's seeded modifier if it exists, and raise an amber note naming the
 * code if it does not. The HOURS need no seeded row at all — prep hours are
 * charged at the charge-out rate whether or not a rate code matches
 * (lib/pricing/estimate.ts), which is the same reason the plastering and
 * raw-timber allowances ride `prepHr`.
 */
export function applySiteAccess(
  access: SiteAccess,
  modifiers: ReadonlyArray<{ code: string; multiplier: number }>,
  allowances: Record<string, HourAllowance> = DEFAULT_HOUR_ALLOWANCES,
): SiteAccessOutcome {
  const modSel: Record<string, string> = {};
  const hours: HourAllowance[] = [];
  const notes: string[] = [];
  const deferred: WizardDeferred[] = [];

  if (access.cleared) {
    const rule = OCCUPANCY_MODIFIERS[access.cleared];
    if (modifiers.some((m) => m.code === rule.code)) {
      modSel[STAGING_GROUP] = rule.code;
    } else {
      deferred.push({
        room: "Whole job", areaId: null, count: 1,
        what: access.cleared === "no" ? "furniture stays" : "rooms cleared",
        needs: `allow about ${rule.pct}% for protection, moving and packing down. `
          + `(Seed the "${rule.code}" modifier at ${(1 + rule.pct / 100).toFixed(2)} in Settings → Pricing → Modifiers to price this automatically.)`,
      });
    }
  }

  for (const key of ["parking:hard", "lift:yes"] as const) {
    const [field, value] = key.split(":") as [keyof SiteAccess, string];
    if (access[field] === value && allowances[key]) hours.push(allowances[key]);
  }

  // Not priced, on Tom's own ruling — but the painter still has to know.
  if (access.stairwell === "yes") {
    notes.push("stairwell or void with high walls — trestles or a platform, and slower cutting in");
  }
  if (access.pets === "yes") {
    notes.push("pets on site — keep doors and gates shut, check before opening up");
  }

  return { modSel, hours, notes, deferred };
}

/** Whether the lift question applies at all (units and apartments only). */
export function asksLift(propertyKind: string | null | undefined): boolean {
  return propertyKind === "unit_apartment";
}
