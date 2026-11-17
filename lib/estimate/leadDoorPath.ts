/**
 * Where the lead page's door leads (Tom, 17 Nov 2026). PURE; client-safe.
 * A bigger job (the Paint Home hand-off) has no online tightening, so its
 * Carry on is the visit page too.
 */
export type DoorTo = "quote" | "visit";

export function doorNextPath(estimateId: string, to: DoorTo, biggerJob: boolean): string {
  const id = encodeURIComponent(estimateId);
  return to === "quote" && !biggerJob ? `/estimate/quote?id=${id}` : `/estimate/visit?id=${id}`;
}
