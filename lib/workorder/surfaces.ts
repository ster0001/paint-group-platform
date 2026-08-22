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
import type { WorkOrderDoc, WOArea } from "./snapshot";

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

export type SurfaceRow = {
  id: string;
  heading: string;
  label: string;
  state: SurfaceState;
  rectification?: boolean;
};

export type Progress = { done: number; total: number; pct: number };

/** "18 / 34" and the bar width — derivable from the data alone, per the brief. */
export function progressOf(surfaces: readonly SurfaceRow[]): Progress {
  const total = surfaces.length;
  const done = surfaces.filter((s) => s.state === "done").length;
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
  if (headingsWithBeforePhoto.includes(heading)) return false;
  // The gate is on the FIRST tick of an elevation: once anything there has moved
  // off todo, the photo requirement has already been met (or waived by staff).
  return surfaces.filter((s) => s.heading === heading).every((s) => s.state === "todo");
}

/** Every surface done — the gate out of in_progress. */
export function allSurfacesDone(surfaces: readonly SurfaceRow[]): boolean {
  return surfaces.length > 0 && surfaces.every((s) => s.state === "done");
}
