import type { Extraction, ExtractedRoom } from "./schema";

/**
 * Stage 3: geometry validation. No AI. This is the stage that earns trust.
 *
 * Nothing here is silent. Every check that fails produces a flag naming the
 * room and saying what was wrong, and the whole report is stored on the run so
 * a bad read can be argued with afterwards rather than discovered in a quote.
 */

export type Flag = {
  level: "room" | "run";
  code: string;
  room: string | null;
  message: string;
  /** True when the estimator must act before this can be priced. */
  blocking: boolean;
};

export type ValidationReport = {
  flags: Flag[];
  roomCount: number;
  dimensionedRooms: number;
  undimensionedRooms: number;
  derivedFloorArea: number;
  statedFloorArea: number | null;
  areaDeltaPct: number | null;
  /** False when the plan cannot be read at all — the caller should reject it. */
  usable: boolean;
};

const roomName = (r: ExtractedRoom, i: number) => r.name_on_plan || `unnamed room ${i + 1}`;

export function validateExtraction(x: Extraction): ValidationReport {
  const flags: Flag[] = [];
  const add = (f: Flag) => flags.push(f);

  const dimensioned = x.rooms.filter((r) => r.length_m != null && r.width_m != null);
  const undimensioned = x.rooms.filter((r) => r.length_m == null || r.width_m == null);

  // ---- can this plan be used at all? ---------------------------------------
  // Section 10: no dimensions, no scale bar and no stated area is a reject, not
  // something to guess around. Roughly one marketing plan in nine.
  const hasAnyScale =
    dimensioned.length > 0 ||
    x.scale.method === "scale_bar" ||
    x.scale.stated_total_area_m2 != null ||
    x.storeys.some((s) => s.stated_area_m2 != null);

  if (!hasAnyScale) {
    add({
      level: "run", code: "no_scale", room: null, blocking: true,
      message: "This plan has no printed dimensions, no scale bar and no stated area. There is nothing to measure from — it needs dimensions or a site visit.",
    });
  }

  if (x.rooms.length === 0) {
    add({ level: "run", code: "no_rooms", room: null, blocking: true, message: "No rooms were found on this page." });
  }

  // ---- the disclaimer ------------------------------------------------------
  if (x.scale.not_to_scale_disclaimer) {
    add({
      level: "run", code: "not_to_scale", room: null, blocking: false,
      message: 'The plan says "not to scale", so nothing can be measured off the drawing. Only the printed dimensions can be trusted; every other room needs a figure from you.',
    });
  }

  // ---- per-room ------------------------------------------------------------
  x.rooms.forEach((r, i) => {
    const name = roomName(r, i);

    if (!r.name_on_plan) {
      add({ level: "room", code: "unnamed", room: name, blocking: true,
        message: "An enclosed space with no label — say what it is, or exclude it." });
    }
    if (r.normalised_type === "unknown") {
      add({ level: "room", code: "unclassified", room: name, blocking: true,
        message: "Not recognised as a room type, so nothing was generated for it." });
    }

    const L = r.length_m, W = r.width_m;
    if (L == null || W == null) {
      // Expected on wet areas — stated plainly rather than flagged as an error.
      add({ level: "room", code: "not_dimensioned", room: name, blocking: true,
        message: "Labelled on the plan but not dimensioned. Needs a size before it can be priced." });
      return;
    }

    const area = L * W;
    if (area < 1.2 || area > 80) {
      add({ level: "room", code: "implausible_size", room: name, blocking: true,
        message: `${L} x ${W} m is ${area.toFixed(1)} m² — outside the 1.2–80 m² range for a residential room. Check the reading.` });
    }
    if (L / W > 8 || W / L > 8) {
      add({ level: "room", code: "implausible_shape", room: name, blocking: false,
        message: `${L} x ${W} m is an extreme proportion for a room. Worth a look.` });
    }
    // The plan's own printed area, when there is one, is a free cross-check.
    if (r.area_m2_printed != null) {
      const delta = Math.abs(area - r.area_m2_printed) / r.area_m2_printed;
      if (delta > 0.03) {
        add({ level: "room", code: "area_mismatch", room: name, blocking: false,
          message: `L × W is ${area.toFixed(1)} m² but the plan prints ${r.area_m2_printed} m² (${(delta * 100).toFixed(0)}% out).` });
      }
    }
    for (const d of r.doors) {
      // Wide is possible (stackers, garage doors) but worth a look, because a
      // misread door width is a misread wall opening.
      if (d.width_m != null && d.width_m > 3.5 && r.normalised_type !== "garage") {
        add({ level: "room", code: "wide_door", room: name, blocking: false,
          message: `A ${d.width_m} m door was read here. That is possible for a stacker or bifold, but check it.` });
      }
    }
    if (r.doors.length === 0 && r.normalised_type !== "storage") {
      add({ level: "room", code: "no_door", room: name, blocking: false,
        message: "No door was found for this room. Doors are priced per item, so a miss costs money." });
    }
    if (r.dimension_confidence < 0.5) {
      add({ level: "room", code: "low_confidence", room: name, blocking: false,
        message: `The dimensions were read with low confidence (${(r.dimension_confidence * 100).toFixed(0)}%).` });
    }
  });

  // ---- whole-plan reconciliation -------------------------------------------
  const derivedFloorArea = dimensioned.reduce((n, r) => n + r.length_m! * r.width_m!, 0);
  const statedFloorArea =
    x.scale.stated_total_area_m2 ??
    (x.storeys.some((s) => s.stated_area_m2 != null)
      ? x.storeys.reduce((n, s) => n + (s.stated_area_m2 ?? 0), 0)
      : null);

  let areaDeltaPct: number | null = null;
  if (statedFloorArea && derivedFloorArea > 0) {
    // Only comparable when every room was dimensioned — otherwise the shortfall
    // is just the rooms we could not read, which is already flagged.
    areaDeltaPct = ((derivedFloorArea - statedFloorArea) / statedFloorArea) * 100;
    if (undimensioned.length === 0 && Math.abs(areaDeltaPct) > 8) {
      add({ level: "run", code: "area_reconciliation", room: null, blocking: false,
        message: `The rooms add up to ${derivedFloorArea.toFixed(0)} m² but the plan states ${statedFloorArea.toFixed(0)} m² (${areaDeltaPct > 0 ? "+" : ""}${areaDeltaPct.toFixed(0)}%). Something has been misread.` });
    }
  }

  if (undimensioned.length > 0) {
    add({ level: "run", code: "undimensioned_rooms", room: null, blocking: true,
      message: `${undimensioned.length} of ${x.rooms.length} rooms are labelled but not dimensioned (${undimensioned.map((r, i) => roomName(r, i)).slice(0, 6).join(", ")}). They still need painting, so they need sizes.` });
  }

  if (x.ceiling_height_m == null) {
    add({ level: "run", code: "assumed_ceiling_height", room: null, blocking: false,
      message: "No ceiling height is printed on the plan, so 2.40 m was assumed. Confirm it once per storey — it multiplies every wall in the job." });
  }

  return {
    flags,
    roomCount: x.rooms.length,
    dimensionedRooms: dimensioned.length,
    undimensionedRooms: undimensioned.length,
    derivedFloorArea: Math.round(derivedFloorArea * 10) / 10,
    statedFloorArea,
    areaDeltaPct: areaDeltaPct == null ? null : Math.round(areaDeltaPct * 10) / 10,
    usable: !flags.some((f) => f.code === "no_scale" || f.code === "no_rooms"),
  };
}
