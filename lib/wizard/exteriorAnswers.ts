/**
 * The exterior ANSWERS, applied to the area nodes — extracted verbatim from
 * the submit route (C15 step 3) so the DRAFT pricer and the SUBMIT path run
 * the same code. Two copies of "storeys give every side its height" is how a
 * drop-out gets valued differently from the estimate they'd have received.
 *
 * What it does (R2, unchanged): lays the four-elevation scaffold when nothing
 * measured the outside; adds the whole-job extras as placeholders; gives
 * unmeasured sides the storey height and typical lengths (tagged assumed);
 * turns condition/access/gear into review deferrals; prices a stated fence
 * length.
 */

import { exteriorExtrasNodes, starterExteriorNodes } from "./starter";
import { applyFenceLength } from "./scope-editor";
import type { WizardState, WizardSurfaceKey } from "./state";
import type { DraftArea } from "@/lib/extract/draft";

export type MergedBundle = {
  areas: DraftArea[];
  skipped: Array<{ name: string; reason: string }>;
  deferred: Array<{ room: string; areaId: number | null; what: string; count: number; needs: string; kind?: string }>;
  assumedCount: number;
};

export function applyExteriorAnswers(
  merged: MergedBundle,
  state: WizardState,
  nextId: () => number,
  tickedSurfaces: ReadonlySet<WizardSurfaceKey>,
): void {
  const wantsExterior = state.jobType === "exterior" || state.jobType === "both";
  if (!wantsExterior) return;

  // Feature #2: an exterior/both job that measured NO exterior surfaces still
  // needs the exterior scaffold — otherwise the estimator sees interior only.
  const hasExteriorNodes = merged.areas.some((a) => a.type === "Exterior");
  if (!hasExteriorNodes) {
    const scaffold = starterExteriorNodes(nextId, tickedSurfaces);
    merged.areas.push(...scaffold.areas);
    merged.deferred = merged.deferred.filter((d) => d.what !== "exterior envelope");
    merged.deferred.push(...scaffold.deferred);
  }

  // A2: ticked whole-job extras are never measured by an elevation read —
  // they always arrive as $0 placeholders to measure.
  const extras = exteriorExtrasNodes(nextId, tickedSurfaces);
  merged.areas.push(...extras.areas);
  merged.deferred.push(...extras.deferred);

  if (!state.exterior) return;
  const ext = state.exterior;

  // Storeys give every side its height; unmeasured sides take typical lengths
  // (12 m front/back, 14 m sides), tagged assumed until the confirm loop
  // settles them.
  const sideH = ext.storeys === "double" ? 5.2 : 2.6;
  for (const a of merged.areas) {
    if (a.type !== "Exterior" || a.areaType !== "surface") continue;
    if (!(Number(a.H) > 0)) {
      a.H = sideH;
      if (!a.assumedFields.includes("H")) a.assumedFields = [...a.assumedFields, "H"];
    }
    if (!(Number(a.L) > 0)) {
      a.L = /front|rear|back/i.test(a.name) ? 12 : 14;
      if (!a.assumedFields.includes("L")) a.assumedFields = [...a.assumedFields, "L"];
    }
  }

  if (ext.condition === "weathered") {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "weathered paintwork", count: 1,
      needs: "extra preparation allowed for — confirm the prep scope at review",
    });
  }
  if (ext.condition === "peeling") {
    merged.deferred.push({
      room: "Exterior", areaId: null, what: "peeling & flaking paint", count: 1,
      needs: "needs eyes on it before a fixed price — prep scope and (pre-1970) a lead-safe check on the visit",
    });
  }
  for (const acc of ext.access) {
    merged.deferred.push({
      room: "Exterior", areaId: null,
      what: acc === "steep" ? "steep block" : acc === "tight" ? "tight side access" : "double-height entry",
      count: 1, needs: "access affects setup time — allow for it at review",
    });
  }
  // Tom, 29 Aug: special access equipment is NOT priced by the wizard — the
  // estimator prices hire, delivery and set-up after confirming the need.
  for (const gear of ext.accessEquipment) {
    merged.deferred.push({
      room: "Exterior", areaId: null,
      what: gear === "scissor_lift" ? "scissor lift access"
        : gear === "boom_lift" ? "boom lift access" : "scaffold / platform access",
      count: 1,
      needs: "customer says this equipment is needed — NOT priced in the estimate; confirm hire, delivery and set-up with them",
    });
  }
  if (ext.extras.fence) {
    if (ext.extras.fenceMetres != null) {
      const priced = applyFenceLength(merged.areas as unknown as Parameters<typeof applyFenceLength>[0], ext.extras.fenceMetres);
      if (priced.ok) {
        merged.areas = priced.blocks as unknown as typeof merged.areas;
        merged.deferred = merged.deferred.filter((d) => !/fence/i.test(d.what));
      }
    } else {
      merged.deferred.push({
        room: "Exterior", areaId: null, what: "fence length", count: 1,
        needs: "customer isn't sure of the fence length — measure it on site",
      });
    }
  }
}
