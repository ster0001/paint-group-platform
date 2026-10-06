/**
 * Visit zones — the outline test (addendum A, S1 step 2).
 *
 * Pure geometry: a point against the approved zone outlines in
 * `docs/briefs/data/visit-zones-draft2.geojson`, features in ascending
 * `priority`, first hit wins, no hit = out of area. Used once, by the seed
 * script, to PROPOSE a status for every Victorian suburb; the rulings CSV then
 * overrides it and every disagreement is reported, never quietly picked.
 *
 * No database, no network. Longitude first, as GeoJSON has it.
 */

export type ZoneStatus = "zone_1" | "zone_2" | "zone_3" | "zone_4" | "zone_5" | "pre_arranged" | "out_of_area";

export type ZoneFeature = {
  type: "Feature";
  properties: { status: string; priority: number; part?: string };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
};

export type ZoneCollection = { type: "FeatureCollection"; features: ZoneFeature[] };

export const ZONE_STATUSES: readonly ZoneStatus[] = ["zone_1", "zone_2", "zone_3", "zone_4", "zone_5", "pre_arranged", "out_of_area"];

export function isZoneStatus(v: unknown): v is ZoneStatus {
  return typeof v === "string" && (ZONE_STATUSES as readonly string[]).includes(v);
}

/** Ray casting; a point on an edge counts as inside. `ring` is [lng, lat][]. */
export function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // On the segment itself.
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && Math.min(xi, xj) - 1e-12 <= x && x <= Math.max(xi, xj) + 1e-12
      && Math.min(yi, yj) - 1e-12 <= y && y <= Math.max(yi, yj) + 1e-12) return true;
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and not inside any hole. */
export function pointInPolygon(point: [number, number], polygon: number[][][]): boolean {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) if (pointInRing(point, polygon[h])) return false;
  return true;
}

export function pointInFeature(point: [number, number], f: ZoneFeature): boolean {
  if (f.geometry.type === "Polygon") return pointInPolygon(point, f.geometry.coordinates);
  return f.geometry.coordinates.some((poly) => pointInPolygon(point, poly));
}

/** Features in ascending priority (lower number tested first), stable for ties. */
export function orderedFeatures(zones: ZoneCollection): ZoneFeature[] {
  return [...zones.features].sort((a, b) => a.properties.priority - b.properties.priority);
}

/**
 * The outline's answer for a point: the status of the first feature (by
 * priority) that contains it, else `out_of_area`. Also says WHICH part hit,
 * for the review CSV.
 */
export function classifyPoint(point: [number, number], zones: ZoneCollection): { status: ZoneStatus; part: string | null } {
  for (const f of orderedFeatures(zones)) {
    if (pointInFeature(point, f)) {
      const s = f.properties.status;
      return { status: isZoneStatus(s) ? s : "out_of_area", part: f.properties.part ?? null };
    }
  }
  return { status: "out_of_area", part: null };
}
