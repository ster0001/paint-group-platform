import { starterRoomList } from "./starter";
import type { QuickLook } from "./quick-look";

/**
 * 14 Sep — "Some rooms": the starter rooms the quick look would seed, by
 * name, so the customer can tick the ones the job is about BEFORE the
 * range. The submit route filters the starter list by these names; an
 * empty or absent pick means every room (the preset used to mean that
 * silently, which is the promise this closes).
 */
export function starterRoomNames(q: Pick<QuickLook, "bedrooms" | "storeys">): string[] {
  return starterRoomList({ bedrooms: Math.max(1, Math.min(8, Math.round(q.bedrooms))), storeys: q.storeys, sizeBand: "unsure", openPlanKitchenLiving: false }).map((r) => r.name);
}

/** The picked subset, or every room when nothing usable was picked. */
export function pickedRooms<T extends { name: string }>(list: T[], picked: string[] | null | undefined): T[] {
  if (!picked || !picked.length) return list;
  const keep = new Set(picked);
  const out = list.filter((r) => keep.has(r.name));
  return out.length ? out : list;
}
