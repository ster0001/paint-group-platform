/**
 * Per-IP brake on the public token routes (/e, /w, /crew, /s, /v, /a, /i,
 * /u, /join, /photos, /api/tenant).
 *
 * CLAUDE.md: "Token routes: … rate-limited." Until 18 Sep 2026 none of them
 * were — the only limiter in the repo (lib/places/publicLimit.ts) sat in
 * front of the address lookup. The tokens themselves are 122+ bits, so this
 * is not what keeps a guesser out; it is what keeps a guesser (or a runaway
 * script) from turning every miss into a database round trip and a signed
 * storage URL. Shared across the token routes so the budget is per visitor,
 * not per door.
 *
 * In-memory, so per Vercel instance — a brake, not a wall (same caveat as
 * publicLimit.ts). Sized for a household opening a few links, not a scanner:
 * a customer clicking through an estimate and its photos is a handful of
 * page loads a minute; e2e workers on one loopback address stay well under.
 *
 * Pure function of (path, ip, now) so it is unit-tested without a request.
 */
const WINDOW_MS = 60_000;
export const TOKEN_ROUTE_LIMIT = 240;

/** First path segment of every route whose second segment is a public token. */
const TOKEN_PREFIXES = new Set(["e", "w", "crew", "s", "v", "a", "i", "u", "join", "photos"]);

export function isTokenRoutePath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  if (parts[0] === "api") return parts[1] === "tenant" && parts.length >= 3;
  return TOKEN_PREFIXES.has(parts[0]);
}

type Bucket = { n: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** True = let it through. False = answer 429. */
export function allowTokenRoute(ip: string, now = Date.now()): boolean {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const key = ip || "unknown";
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { n: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.n >= TOKEN_ROUTE_LIMIT) return false;
  b.n += 1;
  return true;
}

export function clientIpFromHeaders(get: (name: string) => string | null): string {
  return get("x-forwarded-for")?.split(",")[0]?.trim() || get("x-real-ip")?.trim() || "unknown";
}

/** Tests only. */
export function _resetTokenRouteLimit(): void {
  buckets.clear();
}
