/**
 * Session 8 (docs/briefs/website-audiences.md) — one brand, two domains,
 * one codebase. `audience` is decided per request in proxy.ts, never from a
 * cookie:
 *   1. the hostname is the commercial domain            → business
 *   2. the path starts with /business on any other host → business, and a
 *      301 to the same path on the commercial domain when one is configured
 *      (⚑ D1: COMMERCIAL_DOMAIN env; unset = the business site is served at
 *      /business on the residential host, which is how local dev, the C1
 *      test server and the Settings preview see it)
 *   3. otherwise                                        → home
 * Pure, so it is unit-tested over host × path.
 */
export const AUDIENCES = ["home", "business"] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(v: unknown): v is Audience {
  return v === "home" || v === "business";
}

export const AUDIENCE_HEADER = "x-audience";
export const BUSINESS_PREFIX = "/business";

/** The commercial hostname (no scheme, no path), lower-cased; null when not configured. */
export function commercialDomain(env: string | undefined = process.env.COMMERCIAL_DOMAIN): string | null {
  const v = (env ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return v || null;
}

const bareHost = (host: string | null | undefined) => (host ?? "").toLowerCase().split(":")[0];

export type Resolution =
  | { audience: Audience; redirect: null; rewrite: string | null }
  | { audience: "business"; redirect: string; rewrite: null };

/**
 * host + pathname → the audience, and what the proxy must do:
 *  - `redirect`: a 301 target (residential /business… → commercial …)
 *  - `rewrite`: the internal path to serve (commercial root → /business, the
 *    business homepage route; /business/x on the residential host without a
 *    commercial domain → /x with the business header)
 */
export function resolveAudience(host: string | null | undefined, pathname: string, domain: string | null = commercialDomain()): Resolution {
  const h = bareHost(host);
  const onCommercial = domain != null && (h === domain || h === `www.${domain}`);
  const isBizPath = pathname === BUSINESS_PREFIX || pathname.startsWith(`${BUSINESS_PREFIX}/`);
  if (onCommercial) {
    // Everything on the commercial host is business; its root is the business homepage route.
    if (pathname === "/") return { audience: "business", redirect: null, rewrite: BUSINESS_PREFIX };
    if (isBizPath) {
      // /business on the commercial host itself: one canonical home, so send to the root form.
      const rest = pathname.slice(BUSINESS_PREFIX.length) || "/";
      return { audience: "business", redirect: `https://${domain}${rest}`, rewrite: null };
    }
    return { audience: "business", redirect: null, rewrite: null };
  }
  if (isBizPath) {
    const rest = pathname.slice(BUSINESS_PREFIX.length) || "/";
    if (domain) return { audience: "business", redirect: `https://${domain}${rest}`, rewrite: null };
    // No commercial domain yet: serve the business site under /business here.
    return { audience: "business", redirect: null, rewrite: rest === "/" ? null : rest };
  }
  return { audience: "home", redirect: null, rewrite: null };
}

/** Where the nav's "For business →" / "For homes →" link goes: the other domain's root, or the local path when no domain is set. */
export function otherAudienceHref(audience: Audience, domain: string | null = commercialDomain(), residentialOrigin: string | null = process.env.NEXT_PUBLIC_SITE_URL ?? null): string {
  if (audience === "home") return domain ? `https://${domain}/` : BUSINESS_PREFIX;
  // On the business site → the residential homepage.
  const res = (residentialOrigin ?? "").replace(/\/$/, "");
  return domain && res ? `${res}/` : "/";
}

/** The path prefix pages on this audience use for their own links (the business site served locally lives under /business). */
export function audiencePrefix(audience: Audience, domain: string | null = commercialDomain()): string {
  return audience === "business" && !domain ? BUSINESS_PREFIX : "";
}

/** Entry sources for the wizard hand-off (buckets brief §2.1): per audience and placement. */
export function entrySourceFor(audience: Audience, where: "hero" | "bottom"): string {
  const base = audience === "business" ? "commercial_home" : "homepage";
  return where === "hero" ? `${base}_hero` : `${base}_cta`;
}
