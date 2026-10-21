import type { World } from "@/lib/movements/evaluate";
import type { Point } from "@/lib/movements/types";

/**
 * The evaluator's `World` crosses the server → client boundary once per render. Its one
 * non-serialisable member is the suburb centroid Map, which is also the one that is big
 * (every suburb in Victoria): the client needs only the suburbs the week touches — the
 * warehouse's, every job's and every branch's — for `warehousePoint` and the point
 * fallbacks. Calendar titles are resolved on the server (contextBlocks), so the client
 * never needs the whole map.
 */
export type SerialWorld = Omit<World, "suburbs"> & { suburbs: Record<string, Point> };

export function toSerial(world: World): SerialWorld {
  const keep = new Set<string>();
  const add = (s: string | null | undefined) => { if (s) keep.add(s.trim().toLowerCase()); };
  add(world.settings.warehouse.suburb);
  for (const j of world.jobs) add(j.suburb);
  for (const b of world.branches) add(b.suburb);
  const suburbs: Record<string, Point> = {};
  for (const k of keep) { const p = world.suburbs.get(k); if (p) suburbs[k] = p; }
  const { suburbs: _all, ...rest } = world;
  void _all;
  return { ...rest, suburbs };
}

export function fromSerial(w: SerialWorld): World {
  return { ...w, suburbs: new Map(Object.entries(w.suburbs)) };
}
