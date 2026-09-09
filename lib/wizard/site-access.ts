/**
 * Site and access — plan §4.4, prototype screen 9.
 *
 * The gap this closes (plan §2.4): **interior access is never asked.**
 * Stairwells, voids, furniture, floors, parking and lift bookings have no
 * home in the flow at all, so the things that decide how long protection and
 * packing down take are simply absent from the price.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY THERE ARE NO NUMBERS IN THIS FILE
 *
 * The plan says this screen is the allowances spec §4's four modifiers
 * "verbatim" — and §9.1 gates the whole phase on that spec being merged.
 * **It is not in the repository.** Writing four multipliers here would be
 * inventing prices nobody has validated, which is the same thing the exterior
 * derivation was refused for (§4.4).
 *
 * So this follows the pattern `applyConditionPricing` already established for
 * weathered exteriors and occupied homes: each answer names a MODIFIER CODE,
 * and
 *
 *   · if Tom has seeded that modifier — Settings → Pricing → Modifiers —
 *     it applies, at his multiplier;
 *   · if he has not, the answer becomes an amber deferral so the estimator
 *     allows for it by hand.
 *
 * Never a silent no-op, never an invented number. The questions can be asked
 * today and start pricing the moment Tom sets a multiplier, with no deploy.
 */

import type { WizardDeferred } from "./view";

/** One answer that costs something, and the modifier that prices it. */
export type SiteAccessRule = {
  /** The modifier code Tom seeds in Settings → Pricing → Modifiers. */
  code: string;
  /** The group the modifier belongs to — one selection per group applies. */
  group: string;
  /** What the estimator is told when the modifier is not seeded. */
  needs: string;
  /** What the customer is told about why we asked. */
  because: string;
};

export const SITE_ACCESS_GROUP = "Access";
export const STAGING_GROUP = "Staging";

/**
 * Only the answers that IMPLY EXTRA WORK appear here. "The rooms will be
 * cleared" and "no pets" cost nothing and must not raise an amber note — a
 * screen that flags every answer teaches the estimator to ignore the flags.
 */
export const SITE_ACCESS_RULES: Record<string, SiteAccessRule> = {
  "cleared:some": {
    code: "ACC-PART-CLEARED", group: STAGING_GROUP,
    needs: "some furniture stays — allow for moving and re-covering it each day",
    because: "we work around what's left and cover it each day",
  },
  "cleared:no": {
    code: "ACC-FURNITURE-STAYS", group: STAGING_GROUP,
    needs: "furniture stays in the rooms — allow for moving, covering and re-setting each day",
    because: "we move it to the middle, cover it and put it back each day",
  },
  "floors:hard": {
    code: "ACC-HARD-FLOORS", group: SITE_ACCESS_GROUP,
    needs: "hard floors — allow for full drop-sheeting and protection",
    because: "hard floors need more protection than carpet",
  },
  "floors:mixed": {
    code: "ACC-HARD-FLOORS", group: SITE_ACCESS_GROUP,
    needs: "mixed floors — allow for protection on the hard-floor areas",
    because: "hard floors need more protection than carpet",
  },
  "stairwell:yes": {
    code: "ACC-STAIRWELL", group: SITE_ACCESS_GROUP,
    needs: "stairwell or void with high walls — allow for trestles or a platform, and slower cutting in",
    because: "high walls over a stairwell need a platform, and take longer to cut in",
  },
  "parking:hard": {
    code: "ACC-PARKING", group: SITE_ACCESS_GROUP,
    needs: "difficult parking — allow for carrying gear in and out each day",
    because: "carrying gear a long way adds time at each end of the day",
  },
  "lift:yes": {
    code: "ACC-LIFT-BOOKING", group: SITE_ACCESS_GROUP,
    needs: "lift and building booking required — check the building's hours and book the lift before the start date",
    because: "we book the lift and work to the building's hours",
  },
};

/** The stored answers. Every one optional — an unanswered screen costs nothing. */
export type SiteAccess = {
  cleared?: "yes" | "some" | "no";
  floors?: "carpet" | "hard" | "mixed";
  stairwell?: "yes" | "no";
  parking?: "drive" | "street" | "hard";
  /** Units and apartments only — a house never sees it. */
  lift?: "yes" | "no";
  pets?: "yes" | "no";
};

/** The answers as `${question}:${answer}` keys, for looking rules up. */
function answerKeys(a: SiteAccess): string[] {
  return Object.entries(a)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}:${v}`);
}

export type SiteAccessOutcome = {
  /** Modifier selections to merge into the estimate's `modSel`. */
  modSel: Record<string, string>;
  /** Amber notes for every answer whose modifier Tom has not seeded yet. */
  deferred: WizardDeferred[];
  /** The lines the customer reads back — "why we asked". */
  because: string[];
};

/**
 * Answers → modifiers, or amber notes where the modifier does not exist.
 *
 * One selection per modifier GROUP wins, which is how `jobModifier` works —
 * so "furniture stays" and "part cleared" cannot both apply, and the LAST
 * rule in a group is the one kept. The rules are ordered so that is the
 * heavier answer.
 */
export function applySiteAccess(
  access: SiteAccess,
  modifiers: ReadonlyArray<{ code: string; multiplier: number }>,
): SiteAccessOutcome {
  const modSel: Record<string, string> = {};
  const deferred: WizardDeferred[] = [];
  const because: string[] = [];

  for (const key of answerKeys(access)) {
    const rule = SITE_ACCESS_RULES[key];
    if (rule == null) continue;               // an answer that costs nothing
    because.push(rule.because);
    const seeded = modifiers.find((m) => m.code === rule.code);
    if (seeded) {
      modSel[rule.group] = rule.code;
    } else {
      deferred.push({
        room: "Whole job", areaId: null,
        what: key.replace(":", " — "),
        count: 1,
        // Named so Tom can act on it directly rather than wondering where the
        // number was meant to come from.
        needs: `${rule.needs}. (Seed the "${rule.code}" modifier in Settings → Pricing → Modifiers to price this automatically.)`,
      });
    }
  }
  // De-duplicate: hard and mixed floors share a code and a reason.
  return { modSel, deferred, because: [...new Set(because)] };
}

/** Pets are a note for the painter, never a price. */
export function petsNote(access: SiteAccess): string | null {
  return access.pets === "yes" ? "pets on site — keep doors and gates shut, check before opening up" : null;
}

/** Whether the lift question applies at all (units and apartments only). */
export function asksLift(propertyKind: string | null | undefined): boolean {
  return propertyKind === "unit_apartment";
}
