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
/** The ad-platform and campaign parameters that must survive the hand-off (lib/crm/attribution.ts reads them on /estimate). */
export const CARRY_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid", "ref", "referral"] as const;

/** The subset of a page's query string worth carrying to the wizard, clamped. */
export function carriedParams(search: string | URLSearchParams | null | undefined): Array<[string, string]> {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");
  const out: Array<[string, string]> = [];
  for (const k of CARRY_PARAMS) {
    const v = (p.get(k) ?? "").trim();
    if (v) out.push([k, v.slice(0, 200)]);
  }
  return out;
}

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
    /** Session 8 ⚑ D2: the residential origin, when the business site runs on its own domain and must hand off across. */
    origin?: string;
    /** The landing page's query string: utm_* and click ids ride along so a paid
     *  visit that started on the homepage (or the commercial domain, where
     *  localStorage cannot follow) is still attributed at /estimate. */
    carry?: string | URLSearchParams | null;
  } = {},
): string {
  const q = new URLSearchParams();
  const a = address.trim();
  if (a) q.set("address", a);
  q.set("mode", mode);
  if (opts.scope) q.set("scope", opts.scope);
  if (opts.from) q.set("from", opts.from);
  if (opts.src) q.set("src", opts.src);
  for (const [k, v] of carriedParams(opts.carry)) q.set(k, v);
  return `${(opts.origin ?? "").replace(/\/$/, "")}/estimate?${q.toString()}`;
}
