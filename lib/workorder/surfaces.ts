/**
 * The tick list — step 2 of the completion loop.
 *
 * Surfaces are SEEDED from the work-order document the builder already computes
 * (one row per surface, grouped under its area/elevation heading). The document
 * stays the one tree: this is an index into it for ticking, not a second copy of
 * the scope. Nothing here computes or carries money.
 *
 * ONLY REAL WORK IS TICKABLE. The tick list is built from `doc.areas[].surfaces`
 * and nothing else, so scope-level line items — allowances, pass-throughs,
 * traffic management, skip hire — can never appear on it. They are excluded
 * upstream too: `computeWorkOrderDoc` skips any block whose `kind !== "area"`.
 * A painter should never be asked to mark a scaffold hire as "prepped", and the
 * progress bar must mean work done, not lines billed.
 */
import type { WorkOrderDoc, WOArea, WOSurfaceStatus } from "./snapshot";

export type SurfaceState = "todo" | "prepped" | "done";

/** Ordered so a tap can advance, and so progress can be counted. */
export const SURFACE_STATES: readonly SurfaceState[] = ["todo", "prepped", "done"];

export type SeedRow = {
  heading: string;
  headingMeta: string;
  label: string;
  surfaceKey: string;
  sort: number;
};

/**
 * The line under an elevation heading — "3 surfaces · 2 coats · PG-3".
 *
 * The mockup's heading reads "12 × 2.6 m · wb 75 / render 25". Those
 * measurements live in the estimate's sides loop, NOT in the work-order
 * document, and the document is what a frozen snapshot gives us — so rather
 * than invent numbers, this summarises what the document actually knows. When
 * the sides-loop envelope is threaded through to the document, richer text can
 * be passed straight in via seedRowsFromDoc's `metaFor` hook.
 */
export function describeArea(area: WOArea): string {
  const n = area.surfaces.length;
  const bits: string[] = [`${n} surface${n === 1 ? "" : "s"}`];

  const coats = [...new Set(area.surfaces.map((s) => s.coats))].filter((c) => c > 0);
  if (coats.length === 1) bits.push(`${coats[0]} coat${coats[0] === 1 ? "" : "s"}`);
  else if (coats.length > 1) bits.push(`${Math.min(...coats)}–${Math.max(...coats)} coats`);

  if (area.finishCode) bits.push(area.finishCode);
  return bits.join(" · ");
}

/**
 * One row per surface in document order. `sort` is global, not per-area, so the
 * list renders in the document's own order without a second sort key.
 */
export function seedRowsFromDoc(
  doc: WorkOrderDoc,
  metaFor?: (area: WOArea) => string,
): SeedRow[] {
  const rows: SeedRow[] = [];
  let sort = 0;
  for (const area of doc.areas) {
    const headingMeta = metaFor?.(area) ?? describeArea(area);
    for (const surface of area.surfaces) {
      // Defensive: a surface with no label is not work anybody can tick.
      if (!surface.label?.trim()) continue;
      rows.push({
        heading: area.title,
        headingMeta,
        label: surface.label,
        surfaceKey: surface.key,
        sort: sort++,
      });
    }
  }
  return rows;
}

/**
 * The tick list's own three states, said in the job sheet's language.
 *
 * The work-order DOCUMENT carries a `status` per surface, but that is frozen
 * into the snapshot when the order is issued — it is always `not_started`,
 * because nothing writes it afterwards. Ticks live in `wo_surfaces`. So the
 * job sheet has to READ the ticks rather than the snapshot, or it goes on
 * saying "Not started" over an elevation the painter finished a week ago.
 */
export const SURFACE_STATE_LABEL: Record<SurfaceState, string> = {
  todo: "Not started",
  prepped: "Prepped",
  done: "Complete",
};

/** The document's own vocabulary, for anything typed on WOSurfaceStatus. */
export function statusFromState(state: SurfaceState): WOSurfaceStatus {
  return state === "done" ? "complete" : state === "prepped" ? "in_progress" : "not_started";
}

/**
 * Live ticks keyed by the document's surface key, ready to hand to the job
 * sheet. Rows a rectification added have no `surface_key` and no counterpart in
 * the document, so they are skipped rather than guessed at.
 */
export function ticksBySurfaceKey(
  rows: readonly { surface_key: string | null; state: SurfaceState }[],
): Record<string, SurfaceState> {
  const out: Record<string, SurfaceState> = {};
  for (const r of rows) if (r.surface_key) out[r.surface_key] = r.state;
  return out;
}

export type SurfaceRow = {
  id: string;
  heading: string;
  label: string;
  state: SurfaceState;
  rectification?: boolean;
  /** Struck by a signed credit variation — visible, never tickable (A3). */
  removed?: boolean;
  /**
   * "Photos not required" on this line (Tom, 24 Sep 2026) — a fuel allowance,
   * a site set-up line. Set by the office; the row never asks for a before or
   * finished shot, and does not count towards its heading's photo gates.
   */
  photosOptional?: boolean;
};

/** The rows on a heading that photos are counted over — "photos not required" rows are out. */
export function photoRows(surfaces: readonly SurfaceRow[], heading: string): SurfaceRow[] {
  return surfaces.filter((s) => s.heading === heading && !s.photosOptional);
}



export type Progress = { done: number; total: number; pct: number };

/** "18 / 34" and the bar width — derivable from the data alone, per the brief.
 * Struck surfaces are out of the working set: they neither count nor block. */
export function progressOf(surfaces: readonly SurfaceRow[]): Progress {
  const counted = surfaces.filter((s) => !s.removed);
  const total = counted.length;
  const done = counted.filter((s) => s.state === "done").length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Per-heading counts, for the "7/7 ✓" on each elevation. */
export function progressByHeading(surfaces: readonly SurfaceRow[]): Map<string, Progress> {
  const out = new Map<string, SurfaceRow[]>();
  for (const s of surfaces) {
    const list = out.get(s.heading) ?? [];
    list.push(s);
    out.set(s.heading, list);
  }
  return new Map([...out].map(([heading, rows]) => [heading, progressOf(rows)]));
}

/** What a tap moves to: todo → prepped → done → todo (an undo for a mis-tap). */
export function nextState(current: SurfaceState): SurfaceState {
  const i = SURFACE_STATES.indexOf(current);
  return SURFACE_STATES[(i + 1) % SURFACE_STATES.length];
}

/**
 * The photo gate, mirrored for the UI so it can prompt BEFORE the tap rather
 * than explaining a server error afterwards. The server decides; this only
 * decides what to show.
 */
export function needsBeforePhoto(
  heading: string,
  surfaces: readonly SurfaceRow[],
  headingsWithBeforePhoto: readonly string[],
): boolean {
  // Only the rows photos are counted over: a heading of "photos not required"
  // lines asks for nothing at all.
  const mine = photoRows(surfaces, heading);
  if (mine.length === 0) return false;
  if (headingsWithBeforePhoto.includes(heading)) return false;
  // The gate is on the FIRST tick of an elevation: once anything there has moved
  // off todo, the photo requirement has already been met (or waived by staff).
  return mine.every((s) => s.state === "todo");
}

/** Would ticking THIS row need the before shot first? An optional row never does. */
export function tickNeedsBeforePhoto(
  row: SurfaceRow,
  surfaces: readonly SurfaceRow[],
  headingsWithBeforePhoto: readonly string[],
): boolean {
  if (row.photosOptional) return false;
  return needsBeforePhoto(row.heading, surfaces, headingsWithBeforePhoto);
}

/**
 * An elevation that is finished but has no "after" shot yet.
 *
 * The mirror of needsBeforePhoto, at the other end of the work. Before-photos
 * were prompted per elevation and after-photos were not prompted at all — the
 * only route to one was the generic "Photos & notes" panel, which a painter has
 * no reason to open (Tom, 22 Aug). Without them the completion report has a
 * before and nothing to compare it to.
 *
 * Asked for only once every surface on the elevation is done, so it reads as
 * "you've finished this one, snap it" rather than nagging mid-job.
 */
export function needsAfterPhoto(
  heading: string,
  surfaces: readonly SurfaceRow[],
  headingsWithAfterPhoto: readonly string[],
): boolean {
  // Struck-from-scope rows don't count — an elevation whose only unticked rows
  // were removed by a signed credit IS finished (same rule as progressOf).
  // Nor do "photos not required" rows: the shot pairs with the work, not the allowance.
  const mine = photoRows(surfaces, heading).filter((s) => !s.removed);
  if (mine.length === 0) return false;
  if (headingsWithAfterPhoto.includes(heading)) return false;
  return mine.every((s) => s.state === "done");
}

/**
 * Would marking THIS row done complete its heading's photo rows — and so need
 * the finished shot first? The tap that would finish the area opens the picker
 * instead (Tom, 1 Sep); an optional row never does.
 */
export function tickNeedsAfterPhoto(
  row: SurfaceRow,
  surfaces: readonly SurfaceRow[],
  headingsWithAfterPhoto: readonly string[],
): boolean {
  if (row.photosOptional || row.removed) return false;
  if (headingsWithAfterPhoto.includes(row.heading)) return false;
  const others = photoRows(surfaces, row.heading).filter((s) => !s.removed && s.id !== row.id);
  return others.every((s) => s.state === "done");
}

/** Every surface done — the gate out of in_progress. */
export function allSurfacesDone(surfaces: readonly SurfaceRow[]): boolean {
  return surfaces.length > 0 && surfaces.every((s) => s.state === "done");
}
