import type { Extraction, ExtractedRoom } from "./schema";
import { planSurfaces, resolveRoomType, type Alias, type Deferred, type ScopeRule } from "./scope";
import { defectHours, defectSummary, type DefectRate } from "@/lib/capture/commit";

/**
 * Stage 5: turn a validated reading into the builder's own area/surface tree.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: the AI never touches structure and never
 * touches price. What comes out of here is exactly the shape QuoteBuilder makes
 * by hand — same fields, same defaults — with three extra provenance fields on
 * each node. `lib/pricing/` then prices it, unchanged and unaware that a model
 * was involved.
 *
 * It also does no arithmetic on quantities, because it does not need to: the
 * builder already derives walls = 2(L+W) x H, ceilings = L x W and lineal runs
 * = perimeter from the area's dimensions (computeQuantity in
 * lib/pricing/estimate.ts). Setting L, W and H correctly IS the geometry.
 */

export const ASSUMED_CEILING_HEIGHT = 2.4;

export type Origin = "ai_extracted" | "ai_derived" | "ai_assumed" | "human_confirmed";

/** The builder's Surface, plus provenance. Matches QuoteBuilder's newSurface(). */
export type DraftSurface = {
  id: number;
  code: string;
  internalLabel: string;
  clientLabel: string;
  coats: number;
  count: number;
  hidden: boolean;
  media: never[];
  measureL: number | null;
  measureH: number | null;
  qtyOverride: number | null;
  rateOverride: number | null;
  paintingHrOverride: number | null;
  prepHr: number;
  priceOverride: number | null;
  productName: string | null;
  color: string;
  colorHex: string;
  coverageOverride: number | null;
  volumeOverride: number | null;
  unitPriceOverride: number | null;
  crewNote: string;
  hideQty: boolean;
  showCoats: boolean;
  showPrice: boolean;
  useCustomRate: boolean;
  customRate: number | null;
  open: boolean;
  origin: Origin;
  confidence: number;
  assumedFields: string[];
};

/** The builder's Area, plus provenance. Matches QuoteBuilder's newArea(). */
export type DraftArea = {
  id: number;
  kind: "area";
  name: string;
  type: "Interior" | "Exterior";
  areaType: "room" | "surface";
  L: number;
  W: number;
  H: number;
  isOption: boolean;
  description: string;
  open: boolean;
  media: never[];
  surfaces: DraftSurface[];
  origin: Origin;
  confidence: number;
  assumedFields: string[];
  /** Kept so the review queue can say which room on which page this came from. */
  extractionSourceId: string | null;
};

export type DraftResult = {
  areas: DraftArea[];
  /** Rooms that produced nothing, and why — never silently dropped. */
  skipped: Array<{ name: string; reason: string }>;
  assumedCount: number;
  /**
   * Seen but deliberately not priced, because the type is unknown: doors whose
   * style nobody has confirmed, windows, cornices. These are decisions waiting
   * for the estimator, not omissions.
   */
  deferred: Array<{ room: string; what: string; count: number; needs: string }>;
};

function surface(
  id: number,
  code: string,
  label: string,
  count: number,
  origin: Origin,
  confidence: number,
  assumed: string[],
): DraftSurface {
  return {
    id, code, internalLabel: label, clientLabel: label,
    coats: 2, count, hidden: false, media: [],
    measureL: null, measureH: null, qtyOverride: null, rateOverride: null,
    paintingHrOverride: null, prepHr: 0, priceOverride: null, productName: null,
    color: "", colorHex: "", coverageOverride: null, volumeOverride: null,
    unitPriceOverride: null, crewNote: "", hideQty: false, showCoats: false,
    showPrice: false, useCustomRate: false, customRate: null, open: false,
    origin, confidence, assumedFields: assumed,
  };
}

export function buildDraft(
  x: Extraction,
  rules: ScopeRule[],
  aliases: Alias[],
  opts: { startId?: number; sourceId?: string | null; defectRates?: DefectRate[] } = {},
): DraftResult {
  let nextId = opts.startId ?? 1;
  const areas: DraftArea[] = [];
  const skipped: DraftResult["skipped"] = [];
  const deferred: DraftResult["deferred"] = [];
  let assumedCount = 0;

  const ceilingHeight = x.ceiling_height_m ?? ASSUMED_CEILING_HEIGHT;
  const heightAssumed = x.ceiling_height_m == null;

  for (const room of x.rooms) {
    const name = room.name_on_plan?.trim() || "Unnamed room";
    const roomType = room.normalised_type !== "unknown"
      ? room.normalised_type
      : resolveRoomType(room.name_on_plan, aliases);

    if (roomType === "unknown") {
      skipped.push({ name, reason: "not recognised as a room type — classify it and it will generate" });
      continue;
    }
    if (roomType === "exterior_excluded" || roomType === "excluded" || roomType === "exterior") {
      skipped.push({ name, reason: "outside the interior scope (alfresco, void or similar)" });
      continue;
    }

    const plan = planSurfaces(
      roomType,
      {
        doors: room.doors.map((d) => ({ style: d.style })),
        windows: room.windows.map((w) => ({ style: w.style })),
        openings: room.openings_no_door,
        cornice: room.cornice,
      },
      rules,
    );
    const planned = plan.surfaces;
    for (const d of plan.deferred) deferred.push({ room: name, ...d });

    if (planned.length === 0) {
      skipped.push({ name, reason: `no surfaces are configured for a ${roomType}` });
      continue;
    }

    // Dimensions: read from the plan, or left at zero and flagged. Zero is
    // deliberate — it prices at nothing and shows up in the review queue,
    // where an invented size would quietly price at something wrong.
    const dimsRead = room.length_m != null && room.width_m != null;
    const assumedFields: string[] = [];
    if (!dimsRead) assumedFields.push("L", "W");
    if (heightAssumed) assumedFields.push("H");

    const areaOrigin: Origin = dimsRead ? "ai_extracted" : "ai_assumed";
    if (assumedFields.length) assumedCount++;

    const area: DraftArea = {
      id: nextId++,
      kind: "area",
      name,
      type: "Interior",
      areaType: "room",
      L: room.length_m ?? 0,
      W: room.width_m ?? 0,
      H: ceilingHeight,
      isOption: false,
      description: "",
      open: false,
      media: [],
      surfaces: [],
      origin: areaOrigin,
      confidence: room.dimension_confidence,
      assumedFields,
      extractionSourceId: opts.sourceId ?? null,
    };

    for (const p of planned) {
      // A surface is only as certain as the room it sits in: an unmeasured room
      // makes every area-based surface on it an assumption too.
      const isCounted = p.count > 0 && /door|window|architrave/i.test(p.surfaceType);
      const origin: Origin = p.requiresConfirm || (!dimsRead && !isCounted) ? "ai_assumed" : "ai_derived";
      const assumed: string[] = [];
      if (p.requiresConfirm) assumed.push("included");
      if (!dimsRead && !isCounted) assumed.push("quantity");
      if (assumed.length) assumedCount++;

      area.surfaces.push(
        surface(nextId++, p.rateCode, p.surfaceType, p.count, origin, room.dimension_confidence, assumed),
      );
    }

    area.isOption = planned.every((p) => p.isOption);
    areas.push(area);
  }

  // ---- photo-observed defects -> prep on the matched room's walls ----------
  // The model IDENTIFIED (type, severity, extent); the rates table prices it
  // here. Prep lands on the room the photo named, marked assumed so the
  // review queue asks the estimator to confirm before send. A defect whose
  // room can't be matched is DEFERRED, never silently spread across the job.
  const rates = opts.defectRates ?? [];
  for (const obs of x.defect_observations ?? []) {
    const hours = defectHours({ type: obs.type, severity: obs.severity, qty: obs.qty }, rates);
    if (hours <= 0) continue;
    const hintType = obs.room_hint ? resolveRoomType(obs.room_hint, aliases) : "unknown";
    const target = areas.find(
      (a) => obs.room_hint && (a.name.toLowerCase() === obs.room_hint.toLowerCase()
        || (hintType !== "unknown" && resolveRoomType(a.name, aliases) === hintType)),
    );
    if (!target) {
      deferred.push({
        room: obs.room_hint ?? "unmatched photo",
        what: `${obs.type} sev${obs.severity} (~${hours}h prep)`,
        count: 1,
        needs: "which room is this defect in? Assign it and the prep is added.",
      });
      continue;
    }
    const walls = target.surfaces.find((s) => s.code === "Walls") ?? target.surfaces[0];
    if (!walls) continue;
    walls.prepHr = Math.round((walls.prepHr + hours) * 100) / 100;
    const note = defectSummary([{ type: obs.type, severity: obs.severity, qty: obs.qty }], rates);
    walls.crewNote = [walls.crewNote, `photo: ${note}`].filter(Boolean).join(" | ");
    if (!walls.assumedFields.includes("prep")) walls.assumedFields.push("prep");
    if (walls.origin === "ai_derived") walls.origin = "ai_assumed" as Origin;
    assumedCount++;
  }

  return { areas, skipped, assumedCount, deferred };
}

/** Rooms the estimator must deal with before the estimate can be sent. */
export function reviewQueue(areas: DraftArea[]): Array<{ areaId: number; name: string; needs: string }> {
  const out: Array<{ areaId: number; name: string; needs: string }> = [];
  for (const a of areas) {
    if (a.assumedFields.includes("L")) {
      out.push({ areaId: a.id, name: a.name, needs: "size — labelled on the plan but not dimensioned" });
    } else if (a.assumedFields.includes("H")) {
      out.push({ areaId: a.id, name: a.name, needs: "ceiling height — 2.40 m assumed" });
    }
    for (const s of a.surfaces) {
      if (s.assumedFields.includes("included")) {
        out.push({ areaId: a.id, name: `${a.name} — ${s.internalLabel}`, needs: "confirm this belongs on the job" });
      }
      if (s.assumedFields.includes("prep")) {
        out.push({ areaId: a.id, name: `${a.name} — ${s.internalLabel}`, needs: `confirm photo-detected prep (${s.prepHr}h): ${s.crewNote.slice(0, 80)}` });
      }
    }
  }
  return out;
}

export const isRoomSized = (r: ExtractedRoom) => r.length_m != null && r.width_m != null;
