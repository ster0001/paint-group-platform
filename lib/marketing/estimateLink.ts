/**
 * Homepage → wizard hand-off (brief §4.2, Tom 4 Sep). The address field is
 * universal; the home/business choice is an INTENT chip, not an account
 * type. Both travel on the URL as `?address=` and `?mode=home|business`,
 * nothing else — the wizard reads them through lib/marketing/prefill.ts.
 */
export const MODES = ["home", "business"] as const;
export type Mode = (typeof MODES)[number];

export function isMode(v: unknown): v is Mode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

/** The wizard URL for a typed (or picked) address and the chosen chip.
 *  An empty address is simply omitted — the visitor lands on a blank field. */
export function estimateHref(address: string, mode: Mode): string {
  const q = new URLSearchParams();
  const a = address.trim();
  if (a) q.set("address", a);
  q.set("mode", mode);
  return `/estimate?${q.toString()}`;
}
