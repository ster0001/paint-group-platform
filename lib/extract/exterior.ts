/**
 * Exterior envelope - Phase E1: the measurement model and drafting rules.
 *
 * DESIGN CONSTRAINT (recorded in the master plan, tested 18 Aug 2026): the
 * envelope is NEVER derived from interior room boxes - that heuristic scored
 * -53%..+49% against six real exterior work orders. Every envelope number
 * comes from an ELEVATION SOURCE: an elevation photo with a visible height
 * reference, or a site-plan footprint edge. No reference, no number - the
 * segment is deferred and the job carries requires_site_check.
 *
 * Height references a photo can honestly use (same discipline as ceilings):
 *   door_head      an Australian door head is 2.04 m
 *   brick_course   86 mm per course
 *   board_count    weatherboard course cover - counted boards x the course
 *                  size in the measurement_units Settings table (seed: 142 mm)
 *   storey_line    floor lines on a two-storey render/brick facade
 * "proportion_only" is NOT a basis. It prices nothing.
 * Reference sizes live in measurement_units (versioned, Tom-editable); the
 * E2 readers in lib/extract/elevation.ts inject them into the prompt.
 */

import type { DraftArea } from "./draft";

/** Cladding material -> the ACTIVE rate card's exterior code. */
export const CLADDING_TO_RATE: Record<string, string | null> = {
  weatherboard: "Weatherboards",
  render: "Render",
  stucco: "Stucco",
  colorbond: "Colorbond Cladding",
  /** Painted brick now has its own rate (a duplicate of Render), added
   * 20 Aug 2026 — migration 20260919. Needs that SQL run, else it prices $0. */
  brick: "Brick",
  unknown: null,
};

export const TRIM_TO_RATE: Record<string, string> = {
  fascia: "Fascias",
  gutter: "Gutters",
  eaves: "Eaves",
};

export const heightBases = ["door_head", "brick_course", "board_count", "storey_line", "none"] as const;
export const elevations = ["front", "left", "right", "rear", "unknown"] as const;

export type CladdingSegment = {
  material: keyof typeof CLADDING_TO_RATE;
  widthM: number | null;
  /** Where the width came from - site-plan edge or photo reference. */
  widthBasis: "site_plan_edge" | "reference_in_photo" | "none";
  heightM: number | null;
  heightBasis: (typeof heightBases)[number];
  confidence: number;
};

export type ElevationRead = {
  elevation: (typeof elevations)[number];
  cladding: CladdingSegment[];
  /** Lineal metres, only when a width basis exists for the elevation. */
  trims: Array<{ kind: keyof typeof TRIM_TO_RATE; linealM: number | null }>;
  confidence: number;
};

export type EnvelopeSurface = { rateCode: string; label: string; m2?: number; linealM?: number };
export type EnvelopeElevation = {
  name: string;
  widthM: number | null;
  heightM: number | null;
  /** True when any priced width came from the plan (rule 2) rather than a
   * photo reference — always flagged for a human check. */
  widthFromPlan: boolean;
  surfaces: EnvelopeSurface[];
  deferred: Array<{ what: string; needs: string }>;
};
export type Envelope = {
  elevations: EnvelopeElevation[];
  requiresSiteCheck: string[];
  /** Structured whole-house verdict (fewer than 3 measured elevations) -
   * consumers branch on THIS, never on the prose in requiresSiteCheck. */
  wholeHouseCheck: string | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Reads -> envelope. One read per elevation (highest confidence wins);
 * a segment prices ONLY when both its width and height carry a real basis.
 */
export function computeEnvelope(reads: ElevationRead[], minConfidence = 0.6): Envelope {
  const byElevation = new Map<string, ElevationRead>();
  for (const r of reads) {
    const cur = byElevation.get(r.elevation);
    if (!cur || r.confidence > cur.confidence) byElevation.set(r.elevation, r);
  }

  const out: Envelope = { elevations: [], requiresSiteCheck: [], wholeHouseCheck: null };

  for (const [name, read] of byElevation) {
    const el: EnvelopeElevation = { name, widthM: null, heightM: null, widthFromPlan: false, surfaces: [], deferred: [] };

    for (const seg of read.cladding) {
      const rateCode = CLADDING_TO_RATE[seg.material] ?? null;
      const measured =
        seg.widthM != null && seg.widthBasis !== "none" &&
        seg.heightM != null && seg.heightBasis !== "none" &&
        seg.confidence >= minConfidence;

      if (!rateCode) {
        el.deferred.push({ what: `${seg.material} cladding`, needs: "no rate item for this material - price it by hand" });
        out.requiresSiteCheck.push(`${name}: ${seg.material} needs a human price`);
        continue;
      }
      if (!measured) {
        el.deferred.push({ what: `${seg.material} cladding`, needs: "width measurement required - add the width in the builder or measure on site" });
        out.requiresSiteCheck.push(`${name}: ${seg.material} unmeasured`);
        continue;
      }
      el.widthM = Math.max(el.widthM ?? 0, seg.widthM!);
      el.heightM = Math.max(el.heightM ?? 0, seg.heightM!);
      if (seg.widthBasis === "site_plan_edge") el.widthFromPlan = true;
      el.surfaces.push({ rateCode, label: `${seg.material} - ${name}`, m2: round1(seg.widthM! * seg.heightM!) });
    }

    for (const trim of read.trims) {
      const rateCode = TRIM_TO_RATE[trim.kind];
      if (!rateCode) continue;
      if (trim.linealM == null || trim.linealM <= 0) {
        el.deferred.push({ what: trim.kind, needs: "length unknown - measure on site" });
        continue;
      }
      el.surfaces.push({ rateCode, label: `${trim.kind} - ${name}`, linealM: round1(trim.linealM) });
    }

    out.elevations.push(el);
  }

  // Fewer than three measured elevations cannot describe a whole house.
  const measured = out.elevations.filter((e) => e.surfaces.some((s) => s.m2));
  if (measured.length < 3) {
    out.wholeHouseCheck = `only ${measured.length} elevation(s) measured - a whole-house exterior needs all sides`;
    out.requiresSiteCheck.push(out.wholeHouseCheck);
  }

  return out;
}

/** Envelope -> builder Exterior nodes: one "surface"-type area per elevation.
 * Typed as DraftArea so envelope nodes ride the same blocks[] as buildDraft's. */
export function envelopeToAreaNodes(env: Envelope, nextId: () => number, sourceId: string | null = null): DraftArea[] {
  return env.elevations
    .filter((e) => e.surfaces.length > 0)
    .map((e) => ({
      id: nextId(),
      kind: "area" as const,
      name: `Exterior - ${e.name}`,
      type: "Exterior" as const,
      areaType: "surface" as const,
      roomType: "exterior",
      storey: "ground",
      L: e.widthM ?? 0, W: 0, H: e.heightM ?? 0,
      isOption: false, description: "", open: false, media: [],
      origin: "ai_derived" as const, confidence: 0.7,
      // width_from_plan = rule 2 was used: the width is summed room
      // dimensions, not a photo reference — the editor flags it for a check.
      assumedFields: e.widthFromPlan ? ["exterior_envelope", "width_from_plan"] : ["exterior_envelope"],
      extractionSourceId: sourceId,
      surfaces: e.surfaces.map((s) => ({
        id: nextId(), code: s.rateCode, internalLabel: s.label, clientLabel: s.label,
        coats: 2, count: 1, hidden: false, media: [],
        // Explicit measurements, never derived from room geometry:
        measureL: s.linealM ?? null, measureH: null,
        qtyOverride: s.m2 ?? null,
        rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
        productName: null, color: "", colorHex: "", coverageOverride: null,
        volumeOverride: null, unitPriceOverride: null, crewNote: "",
        hideQty: false, showCoats: false, showPrice: false, useCustomRate: false,
        customRate: null, open: false,
        origin: "ai_derived" as const, confidence: 0.7, assumedFields: ["exterior_envelope"],
      })),
    }));
}
