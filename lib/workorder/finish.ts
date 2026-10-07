// The PG finish level on a job sheet — which of the three approved standards
// (docs/standards/finish-standards-v1.json, Levels 2, 3 and 4) a painter is
// held to, and the one-screen summary of each that the FinishChip opens.
//
// The WORDS below are the approved guide's "levels" block, copied so a client
// component needs no fetch; lib/standards/source.test.ts pins this copy to the
// file, so a new version of the guide fails the build until the copy follows.
// The full standard for each surface lives in the standards tables
// (lib/standards) and the chip links there.
//
// Two things to know, flagged rather than decided silently:
//  1. The internal pricing modifier FIN-4 is labelled "Premium" in the rate
//     card, while the approved guide calls Level 4 "Premium finish" and Level 3
//     "Our standard finish". The NUMBERS are what map; the painter-facing
//     words follow the guide.
//  2. FIN-1 ("Basic", 0.8× labour) has no PG equivalent — the guide defines
//     only Levels 2/3/4. It is deliberately left UNMAPPED rather than promoted
//     to PG-2, because telling a contractor "PG-2" on a job priced at FIN-1
//     would hold them to more prep than the customer paid for. The job sheet
//     says so plainly.

export type FinishCode = "PG-2" | "PG-3" | "PG-4";

export type FinishLevel = {
  code: FinishCode;
  /** The guide's name for the level — "Our standard finish". */
  name: string;
  /** The look-test distance — "1.5 m". */
  lookTest: string;
  /** The guide's five summary rows: Filling, Sanding, Gaps, Old problems, Look test. */
  rows: { label: string; text: string }[];
};

export const FINISH_LEVELS: Record<FinishCode, FinishLevel> = {
  "PG-2": {
    code: "PG-2",
    name: "Clean, tidy repaint",
    lookTest: "3 m",
    rows: [
      { label: "Filling", text: "All holes, nail holes and open cracks. Small marks in the old surface can stay." },
      { label: "Sanding", text: "Light sand. Remove loose paint and dust." },
      { label: "Gaps (caulking)", text: "Edges of frames and trim." },
      { label: "Old problems (old runs, old paint on glass, old brush marks)", text: "Can stay." },
      { label: "Look test", text: "Stand 3 m back." },
    ],
  },
  "PG-3": {
    code: "PG-3",
    name: "Our standard finish",
    lookTest: "1.5 m",
    rows: [
      { label: "Filling", text: "Every mark you can see from 1.5 m." },
      { label: "Sanding", text: "Sand well. Smooth to touch." },
      { label: "Gaps (caulking)", text: "Edges, mitres and corners." },
      { label: "Old problems (old runs, old paint on glass, old brush marks)", text: "Fix what you can see from 1.5 m." },
      { label: "Look test", text: "Stand 1.5 m back." },
    ],
  },
  "PG-4": {
    code: "PG-4",
    name: "Premium finish",
    lookTest: "0.5 m",
    rows: [
      { label: "Filling", text: "Every mark you can see from 0.5 m." },
      { label: "Sanding", text: "Sand smooth before the first coat and between coats." },
      { label: "Gaps (caulking)", text: "Every gap and join." },
      { label: "Old problems (old runs, old paint on glass, old brush marks)", text: "Fix all of them." },
      { label: "Look test", text: "Stand 0.5 m back (arm's length)." },
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

/**
 * The pricing modifiers that HAVE a contractor-facing standard, in rung order.
 * FIN-1 is deliberately absent — see note 2 at the top of this file. The office
 * correcting an issued job sheet picks from exactly this list, and the RPC
 * refuses anything else rather than guessing a level for a painter.
 */
export const CORRECTABLE_FINISH_MODIFIERS = ["FIN-2", "FIN-3", "FIN-4"] as const;
export type CorrectableFinishModifier = typeof CORRECTABLE_FINISH_MODIFIERS[number];

export function isCorrectableFinishModifier(code: string): code is CorrectableFinishModifier {
  return (CORRECTABLE_FINISH_MODIFIERS as readonly string[]).includes(code);
}

/**
 * The document-side half of wo_set_finish_level, kept in TypeScript so the SQL
 * can be tested against the same rule (the pattern lib/workorder/materials.ts
 * set for wo_set_material).
 *
 * The job's standard changes, and every area that never carried an override of
 * its own follows it down — which is the cascade the builder already assumes:
 * onAreaFinish stores NOTHING for an area on the job's level, precisely "so
 * changing the job level still cascades". An area that WAS overridden keeps its
 * own code, but `finishOverridden` is recomputed against the new job level, so
 * an override that now agrees with the job stops being flagged as a difference
 * — the same expression computeWorkOrderParts uses when it builds the document.
 */
export function applyFinishLevelEdit<
  T extends {
    levelOfFinish: string;
    finishCode: string | null;
    areas?: { finishCode?: string | null; finishOverridden?: boolean }[];
  },
>(doc: T, finishCode: FinishCode, levelLabel: string): T {
  const areas = (doc.areas ?? []).map((a) => {
    const override = a.finishOverridden ? (a.finishCode ?? null) : null;
    return {
      ...a,
      finishCode: override ?? finishCode,
      finishOverridden: Boolean(override && override !== finishCode),
    };
  });
  return { ...doc, levelOfFinish: levelLabel, finishCode, ...(doc.areas ? { areas } : {}) };
}
