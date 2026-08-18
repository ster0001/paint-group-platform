/**
 * The quantity resolver - measureBasis in, quantity out. Pure, no I/O.
 *
 * This is the shared maths under the capture tile grid, the wizard's room
 * cards and (already, implicitly) the plan reader's drafts: walls come from
 * perimeter x height, ceilings from L x W, lineal surfaces from perimeter.
 * One function so the number on a tile, the number in the builder and the
 * number on the work order can never disagree.
 *
 * openingsDeductionM2 defaults to 0 deliberately: current quotes do not
 * deduct door/window openings from wall area, and switching that on is a
 * pricing decision to be made in Settings, not a side effect of a refactor.
 */

export type MeasureBasis =
  | "wall_area"
  | "ceiling_area"
  | "perimeter"
  | "perimeter_less_doors"
  | "per_item"
  | "manual_m2"
  | "manual_lin";

export type RoomGeometry = {
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Extra wall lengths for L-shapes, nibs, bays. Adds to the derived perimeter. */
  extraWallSegmentsM?: number[];
  /** A hand-corrected perimeter wins over the derived one. */
  perimeterOverrideM?: number | null;
};

/** 2(L+W) + segments, unless the estimator overrode it. */
export function perimeterM(geo: RoomGeometry): number {
  if (geo.perimeterOverrideM != null && geo.perimeterOverrideM > 0) return geo.perimeterOverrideM;
  const segments = (geo.extraWallSegmentsM ?? []).reduce((a, b) => a + b, 0);
  return 2 * (geo.lengthM + geo.widthM) + segments;
}

export type QuantityInput = {
  basis: MeasureBasis;
  geo: RoomGeometry;
  /** For per_item tiles: the tap count. */
  count?: number;
  /** For manual_* tiles: the typed value. */
  manualValue?: number;
  /** For perimeter_less_doors: door count in the room. */
  doorCount?: number;
  /** Wall-area openings deduction, m2 total. Default 0 - see header. */
  openingsDeductionM2?: number;
  /** Standard door width for perimeter_less_doors, metres. */
  doorWidthM?: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resolve one tile's quantity. Returns m2 for area bases, lineal metres for
 * perimeter bases, the count for per_item, the typed value for manual.
 * Never negative: a deduction larger than the surface clamps to 0 rather than
 * producing a nonsense credit.
 */
export function resolveQuantity(input: QuantityInput): number {
  const { basis, geo } = input;
  switch (basis) {
    case "wall_area": {
      const gross = perimeterM(geo) * geo.heightM;
      return round2(Math.max(0, gross - (input.openingsDeductionM2 ?? 0)));
    }
    case "ceiling_area":
      return round2(geo.lengthM * geo.widthM);
    case "perimeter":
      return round2(perimeterM(geo));
    case "perimeter_less_doors": {
      const doors = (input.doorCount ?? 0) * (input.doorWidthM ?? 0.82);
      return round2(Math.max(0, perimeterM(geo) - doors));
    }
    case "per_item":
      return Math.max(0, Math.round(input.count ?? 0));
    case "manual_m2":
    case "manual_lin":
      return round2(Math.max(0, input.manualValue ?? 0));
  }
}

/**
 * The plausibility check from the room-loop brief section 9: for a sane
 * rectangle-ish room, perimeter squared over area sits between 14 and 30.
 * Returns null when the check does not apply (irregular rooms opt out).
 */
export function perimeterPlausibility(geo: RoomGeometry, irregular: boolean): "ok" | "suspicious" | null {
  if (irregular) return null;
  const area = geo.lengthM * geo.widthM;
  if (area <= 0) return null;
  const ratio = perimeterM(geo) ** 2 / area;
  return ratio >= 14 && ratio <= 30 ? "ok" : "suspicious";
}
