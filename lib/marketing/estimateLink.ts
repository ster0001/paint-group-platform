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
export function estimateHref(
  address: string,
  mode: Mode,
  opts: {
    /** §4.4c block 8: the showcase job's type, so the wizard can pre-fill scope (wired in session 4). */
    scope?: string;
    /** The showcase slug the visitor came from. */
    from?: string;
    /** Buckets brief §2.1: where the visitor started — `homepage_hero`, `homepage_cta`, `job_page:<slug>`; the wizard stores it as the lead source. */
    src?: string;
  } = {},
): string {
  const q = new URLSearchParams();
  const a = address.trim();
  if (a) q.set("address", a);
  q.set("mode", mode);
  if (opts.scope) q.set("scope", opts.scope);
  if (opts.from) q.set("from", opts.from);
  if (opts.src) q.set("src", opts.src);
  return `/estimate?${q.toString()}`;
}
