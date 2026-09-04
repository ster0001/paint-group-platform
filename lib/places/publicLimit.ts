/**
 * (Also brakes the first-party event sink, /api/events — same shape.)
 *
 * The address lookup proxy (/api/places/*) was session-only: staff or an
 * anonymous wizard session. The marketing homepage has NO session — a
 * visitor typing an address is exactly who we want suggestions for, and
 * signing every typist in anonymously would spend the anon-auth rate limit
 * on people who never proceed (crm-phase0 C1). So a sessionless caller is
 * allowed through two brakes instead:
 *
 *  1. same-origin only — a browser fetch from our own page carries
 *     `Sec-Fetch-Site: same-origin`; a script elsewhere does not;
 *  2. a per-IP token bucket, sized for a human typing, not a harvester.
 *
 * The bucket is in-memory, so on Vercel it is per instance — a brake, not
 * a wall. The Google key is still server-only and the session token still
 * groups a keystroke run with its details call for Google's billing.
 */
const WINDOW_MS = 10 * 60_000;
const LIMITS = { autocomplete: 60, details: 20, events: 240 } as const;
export type PlacesKind = keyof typeof LIMITS;

type Bucket = { n: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function allowPublicPlaces(request: Request, kind: PlacesKind, now = Date.now()): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;

  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const key = `${kind}:${clientIp(request)}`;
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { n: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.n >= LIMITS[kind]) return false;
  b.n += 1;
  return true;
}

/** Tests only. */
export function _resetPublicPlacesLimit(): void {
  buckets.clear();
}
