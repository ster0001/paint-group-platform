import type { QuickLookStep } from "@/lib/wizard/quick-look";

/**
 * The step rail in the wizard header (UI refresh S1, brief §7.1 / §7.7).
 *
 * The ORDER is never written down here: it is whatever `stepsFor()` returns
 * for the answers so far. This module only names each step — a short label
 * for the rail, a longer one for the phone's "Step 2 of 6 · The place" — and
 * decides what the rail ends in. The `Record` is exhaustive on purpose: a
 * new step in `QUICK_LOOK_STEPS` fails the typecheck until it has a name.
 */
export const STEP_LABELS: Record<QuickLookStep, { rail: string; long: string }> = {
  start: { rail: "Address", long: "Address" },
  both: { rail: "Inside and outside", long: "Inside and outside" },
  place: { rail: "Place", long: "The place" },
  segment: { rail: "Space", long: "The space" },
  com_areas: { rail: "Areas", long: "The areas" },
  com_warehouse: { rail: "Building", long: "The building" },
  com_job: { rail: "Job", long: "The job" },
  com_brief: { rail: "Questions", long: "A few questions" },
  com_book: { rail: "Book", long: "Book a visit" },
  job: { rail: "Job", long: "The job" },
  rooms: { rail: "Rooms", long: "The rooms" },
  condition: { rail: "Condition", long: "Condition" },
  outside: { rail: "Outside", long: "The outside" },
  sides: { rail: "Sides", long: "Which sides" },
  gate: { rail: "Details", long: "Your details" },
};

/** More counted steps than this and the rail shows numbered dots with only the current label (brief §7.7). */
export const RAIL_FULL_MAX = 6;

export type Rail = {
  /** The counted steps, in `stepsFor()` order — the "both" choice screen is not one (brief §7.7). */
  steps: QuickLookStep[];
  /** Index of the current step in `steps`; the choice screen sits before the second, so it reads as the first. */
  current: number;
  /** What the rail ends in: a visit-only path books, every other path reveals a range. */
  end: "Your range" | "Booked";
  compact: boolean;
  /** How far along, 0–1, for the progress stripe. */
  progress: number;
  /** "Step 2 of 6 · The place". */
  phoneLine: string;
  /** "3 steps to your range" / "Last step". */
  remaining: string;
};

export function railFor(all: readonly QuickLookStep[], at: QuickLookStep): Rail {
  const steps: QuickLookStep[] = all.filter((s) => s !== "both");
  // The "both" choice screen comes between the address and the place: it reads as the first counted step.
  const current = Math.max(0, steps.indexOf(at));
  const end = steps.includes("com_book") ? "Booked" : "Your range";
  const left = steps.length - 1 - current;
  const tail = end === "Booked" ? "your visit" : "your range";
  return {
    steps,
    current,
    end,
    compact: steps.length > RAIL_FULL_MAX,
    progress: steps.length ? (current + 0.5) / steps.length : 0,
    phoneLine: `Step ${current + 1} of ${steps.length} · ${STEP_LABELS[at].long}`,
    remaining: left <= 0 ? "Last step" : `${left} step${left === 1 ? "" : "s"} to ${tail}`,
  };
}
