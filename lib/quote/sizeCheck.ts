/**
 * Go-live S4, C3 (D8, 18 Nov 2026): a typed size is CHECKED before it is saved.
 *
 * Letters or a blank where a number was typed are refused with a message and
 * nothing advances. A side over 10 m — over 6 m in a bedroom, bathroom,
 * laundry or WC — or under 1 m is confirmed first ("That's larger than most
 * rooms — is it right?"). Nothing is clamped quietly: what the customer
 * confirms is what is saved. The server's own bounds (0.1–500 m a side,
 * 2–6 m a ceiling) are refused here with a message rather than met with a
 * silent rejection.
 *
 * Why these numbers: 95% of all rooms are under 10 m a side; 95% of bedrooms
 * are under 5 m, the largest 8 m (the audit's data). Tom took the defaults.
 */

export type RoomDims = { widthM: number; lengthM: number; heightM: number | null };
export type SideDims = { w: number; h: number };

export type SizeCheck<D> =
  | { kind: "ok"; dims: D }
  | { kind: "invalid"; message: string }
  | { kind: "confirm"; message: string; dims: D };

export const ROOM_SIDE_MAX_M = 10;
export const SMALL_ROOM_SIDE_MAX_M = 6;
export const ROOM_SIDE_MIN_M = 1;
/** The server's bounds for a ceiling (`room_dims`), and the height above which we ask. */
export const CEILING_MIN_M = 2;
export const CEILING_MAX_M = 6;
export const CEILING_ASK_ABOVE_M = 4;

export const SIZE_INVALID = "Numbers only, in metres — like 3.5.";

/** A bedroom, bathroom, ensuite, laundry, WC, toilet or powder room — the 6 m rooms. Judged from the room's name. */
export function isSmallRoom(name: string): boolean {
  return /\b(bed(room)?|bath(room)?|ensuite|en-suite|laundry|wc|toilet|powder)\b/i.test(name);
}

/** A typed field: null when blank, NaN when it is not a positive number. */
export function parseMetres(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  if (!/^\d*\.?\d+$/.test(t.replace(/\s*m$/i, ""))) return NaN;
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

export function checkRoomSize(
  draft: { w: string; l: string; h: string },
  typical: { widthM: number; lengthM: number; heightM: number },
  roomName: string,
): SizeCheck<RoomDims> {
  const w = parseMetres(draft.w), l = parseMetres(draft.l), h = parseMetres(draft.h);
  if (Number.isNaN(w) || Number.isNaN(l) || Number.isNaN(h)) return { kind: "invalid", message: SIZE_INVALID };
  const dims: RoomDims = { widthM: w ?? typical.widthM, lengthM: l ?? typical.lengthM, heightM: h };
  if (dims.widthM > 500 || dims.lengthM > 500 || dims.widthM < 0.1 || dims.lengthM < 0.1) {
    return { kind: "invalid", message: "That's not a room size we can price — check the number." };
  }
  if (h != null && (h < CEILING_MIN_M || h > CEILING_MAX_M)) {
    return { kind: "invalid", message: `Ceilings are between ${CEILING_MIN_M} and ${CEILING_MAX_M} m — check the number.` };
  }
  const max = isSmallRoom(roomName) ? SMALL_ROOM_SIDE_MAX_M : ROOM_SIDE_MAX_M;
  const typedSides = [w, l].filter((n): n is number => n != null);
  if (typedSides.some((n) => n > max)) return { kind: "confirm", message: "That's larger than most rooms — is it right?", dims };
  if (typedSides.some((n) => n < ROOM_SIDE_MIN_M)) return { kind: "confirm", message: "That's smaller than most rooms — is it right?", dims };
  if (h != null && h > CEILING_ASK_ABOVE_M) return { kind: "confirm", message: "That's a high ceiling — is it right?", dims };
  return { kind: "ok", dims };
}

/** The sides model's own bounds (`setSideSize`): 0.5–60 m across, 1–12 m high. Outside them we refuse rather than clamp. */
export const SIDE_ACROSS_MAX_M = 60;
export const SIDE_HIGH_MAX_M = 12;
export const SIDE_MIN_M = 1;

export function checkSideSize(draft: { w: string; h: string }, typical: { w: number; h: number }): SizeCheck<SideDims> {
  const w = parseMetres(draft.w), h = parseMetres(draft.h);
  if (Number.isNaN(w) || Number.isNaN(h)) return { kind: "invalid", message: SIZE_INVALID };
  const dims: SideDims = { w: w ?? typical.w, h: h ?? typical.h };
  if (dims.w < SIDE_MIN_M || dims.w > SIDE_ACROSS_MAX_M || dims.h < SIDE_MIN_M || dims.h > SIDE_HIGH_MAX_M) {
    return { kind: "invalid", message: `A side runs ${SIDE_MIN_M}–${SIDE_ACROSS_MAX_M} m across and ${SIDE_MIN_M}–${SIDE_HIGH_MAX_M} m high — check the number.` };
  }
  return { kind: "ok", dims };
}
