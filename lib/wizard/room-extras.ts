/**
 * C10 (v2.5, prototype `s-room` "Extras in this room") — feature walls counted
 * per room, wallpaper to strip, and "something else in here".
 *
 * None of these has a rate card code today (checked 12 Sep: no rate item
 * matches feature / wallpaper / strip), so none is PRICED here. Each becomes
 * a deferral pinned to the room — a review line the estimator prices by hand
 * on the pack's "Still open" list — exactly the way the whole-job extra note
 * already works (lib/wizard/extras.ts). The customer is told plainly that a
 * person prices it. When Tom seeds the codes, the same action can price.
 */
import type { WizardDeferred } from "./view";

export const ROOM_EXTRA_KINDS = ["feature_wall", "wallpaper", "other"] as const;
export type RoomExtraKind = (typeof ROOM_EXTRA_KINDS)[number];

export const ROOM_EXTRA_KIND_PREFIX = "room_extra:";

export type RoomExtraInput = {
  areaId: number;
  room: string;
  kind: RoomExtraKind;
  /** Feature walls: how many. Absent or 0 clears. */
  count?: number | null;
  /** Wallpaper: on or off. */
  on?: boolean | null;
  /** Other: what it is. Blank clears. */
  text?: string | null;
};

/** The deferral this answer raises, or null when the answer clears it. */
export function roomExtraDeferral(i: RoomExtraInput): WizardDeferred | null {
  const base = { room: i.room, areaId: i.areaId, kind: `${ROOM_EXTRA_KIND_PREFIX}${i.kind}` };
  if (i.kind === "feature_wall") {
    const n = Math.max(0, Math.min(6, Math.floor(Number(i.count) || 0)));
    if (n === 0) return null;
    return { ...base, what: `${n} feature wall${n === 1 ? "" : "s"}`, count: n,
      needs: "priced as its own colour — one extra colour per feature wall, cutting in both ways; not on the card, so price it by hand before send" };
  }
  if (i.kind === "wallpaper") {
    if (i.on !== true) return null;
    return { ...base, what: "wallpaper to strip first", count: 1,
      needs: "stripping, washing the size off and sealing before any paint — hours depend on the paper and the wall behind it; price by hand or confirm on the visit" };
  }
  const text = (i.text ?? "").trim().slice(0, 120);
  if (text === "") return null;
  return { ...base, what: `something else in here: "${text}"`, count: 1,
    needs: "named by the customer and not on our card — price it by hand, or say it is out of scope, before this estimate is sent" };
}

/** Replace this room's deferral of this kind with the new one (or drop it). */
export function applyRoomExtra(deferred: readonly WizardDeferred[], i: RoomExtraInput): WizardDeferred[] {
  const kind = `${ROOM_EXTRA_KIND_PREFIX}${i.kind}`;
  const kept = deferred.filter((d) => !(d.areaId === i.areaId && d.kind === kind));
  const next = roomExtraDeferral(i);
  return next ? [...kept, next] : kept;
}

/** What the room card shows back: the customer's own extras, read off the deferrals. */
export function roomExtrasView(deferred: readonly WizardDeferred[], areaId: number): { featureWalls: number; wallpaper: boolean; other: string } {
  const mine = deferred.filter((d) => d.areaId === areaId && typeof d.kind === "string" && d.kind.startsWith(ROOM_EXTRA_KIND_PREFIX));
  const fw = mine.find((d) => d.kind === `${ROOM_EXTRA_KIND_PREFIX}feature_wall`);
  const other = mine.find((d) => d.kind === `${ROOM_EXTRA_KIND_PREFIX}other`);
  return {
    featureWalls: fw ? fw.count : 0,
    wallpaper: mine.some((d) => d.kind === `${ROOM_EXTRA_KIND_PREFIX}wallpaper`),
    other: other ? (other.what.match(/"(.*)"$/)?.[1] ?? "") : "",
  };
}
