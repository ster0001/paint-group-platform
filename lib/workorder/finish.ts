// The PG finish-level standard — what a contractor is actually held to on site.
//
// These are the DEFAULTS, in code, following the same pattern as
// lib/estimate/inclusionTemplates.ts: built-in text that a `settings` row can
// override later without a schema change (the build plan's "nothing hardcoded"
// rule). Nothing reads a settings override yet — when the Settings editor is
// built, resolve through it and fall back to these.
//
// Two things Tom should confirm, flagged rather than decided silently:
//  1. The internal pricing modifier FIN-4 is labelled "Premium", but the spec
//     calls PG-3 "Premium" and PG-4 "Showcase". The words clash at different
//     rungs; the NUMBERS are what map. Contractor-facing wording follows the
//     spec (PG-3 Premium, PG-4 Showcase).
//  2. FIN-1 ("Basic", 0.8× labour) has no PG equivalent — the spec defines only
//     PG-2/3/4. It is deliberately left UNMAPPED rather than promoted to PG-2,
//     because telling a contractor "PG-2" on a job priced at FIN-1 would hold
//     them to more prep than the customer paid for. FIN-1 is marked
//     "Judgement — no Level 1 jobs in history" in the rate card, so this should
//     never come up in practice; if it does, the work order says so plainly.

export type FinishCode = "PG-2" | "PG-3" | "PG-4";

export type FinishLevel = {
  code: FinishCode;
  /** Short name shown beside the code — "Utility", "Premium", "Showcase". */
  name: string;
  /** One line, for the chip's tooltip and the sheet's subheading. */
  summary: string;
  /** Where this level is normally used — helps a contractor sanity-check the job. */
  typicalUse: string;
  /** The prep the contractor is committing to. */
  prep: string[];
  /** How the work will be judged at walkthrough. This is the acceptance test. */
  acceptance: string[];
};

export const FINISH_LEVELS: Record<FinishCode, FinishLevel> = {
  "PG-2": {
    code: "PG-2",
    name: "Utility",
    summary: "Sound, even coverage. Serviceable rather than showpiece.",
    typicalUse: "Garages, sheds, back-of-house, rentals between tenants, ceilings in service areas.",
    prep: [
      "Light sand to key the surface",
      "Spot prime bare or patchy areas only",
      "Minor filling — obvious holes and dents",
      "Dust down and mask what needs protecting",
    ],
    acceptance: [
      "Even colour and sheen with no misses, runs or heavy laps",
      "Cut lines straight and consistent, small waver acceptable",
      "Minor substrate imperfections may remain — they are not defects at this level",
      "Judged from 2 m in normal light",
    ],
  },
  "PG-3": {
    code: "PG-3",
    name: "Premium",
    summary: "Full prep per scope, uniform finish, crisp cut lines.",
    typicalUse: "The default for most residential repaints — living areas, bedrooms, hallways, kitchens.",
    prep: [
      "Full sand back as the scope requires",
      "Fill, sand and spot-prime all holes, dents and cracks",
      "Seal bare substrate and any stains",
      "Caulk gaps to trim, cornice and architraves",
      "Full masking and floor protection",
    ],
    acceptance: [
      "No visible defects from 1.5 m in normal light",
      "Crisp, straight cut lines to ceilings, trim and edges",
      "Uniform sheen with no flashing, picture framing or roller marks",
      "Filled areas invisible under the finished coat",
      "Site left clean daily",
    ],
  },
  "PG-4": {
    code: "PG-4",
    name: "Showcase",
    summary: "Double-filled and inspected between coats. Sharp lines throughout.",
    typicalUse: "Heritage work, feature rooms, display homes, high-gloss and dark colours where every flaw shows.",
    prep: [
      "Double fill — fill, sand, re-fill and re-sand",
      "Full prime coat, not spot priming",
      "Inspection under work light between coats, defects marked and rectified",
      "Caulk and dress every junction",
      "Full protection of the room, not just the working area",
    ],
    acceptance: [
      "No visible defects from 0.5 m under raking light",
      "Perfectly sharp cut lines, no waver",
      "Dead-uniform sheen — critical on gloss and dark colours",
      "No fill shadowing, telegraphing or sanding scratches",
      "Signed off at walkthrough before final invoice",
    ],
  },
};

export const DEFAULT_FINISH: FinishCode = "PG-3";

/**
 * Map an internal pricing modifier code (FIN-1..FIN-4) to the contractor-facing
 * PG level. Returns null when there is no equivalent — see note 2 at the top.
 */
export function finishFromModifier(code: string | null | undefined): FinishCode | null {
  switch ((code ?? "").trim().toUpperCase()) {
    case "FIN-2":
      return "PG-2";
    case "FIN-3":
      return "PG-3";
    case "FIN-4":
      return "PG-4";
    default:
      return null; // FIN-1 and anything unrecognised
  }
}

/** Safe lookup — unknown codes give null rather than throwing on a work order. */
export function finishLevel(code: string | null | undefined): FinishLevel | null {
  const key = (code ?? "").trim().toUpperCase();
  return (FINISH_LEVELS as Record<string, FinishLevel>)[key] ?? null;
}

export const FINISH_ORDER: FinishCode[] = ["PG-2", "PG-3", "PG-4"];
