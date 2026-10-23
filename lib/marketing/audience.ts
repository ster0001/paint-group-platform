/**
 * Session 8 (docs/briefs/website-audiences.md) — one brand, two domains,
 * one codebase — extended by the Paint Home brief (docs/briefs/paint-home.md
 * §3) with a THIRD audience, `painthome`: a second shopfront on the same
 * business. `audience` is decided per request in proxy.ts, never from a
 * cookie:
 *   0. the hostname is Paint Home's (painthome.com.au, www, or
 *      painthome.localhost for dev and the e2e)        → painthome
 *   1. the hostname is the commercial domain            → business
 *   2. the path starts with /business on any other host → business, and a
 *      301 to the same path on the commercial domain when one is configured
 *      (⚑ D1: COMMERCIAL_DOMAIN env; unset = the business site is served at
 *      /business on the residential host, which is how local dev, the C1
 *      test server and the Settings preview see it)
 *   3. the path starts with /painthome on any other host → painthome: served
 *      locally on a dev host (the Settings preview, C1), a 301 to
 *      painthome.com.au anywhere else — one canonical home, and the Paint
 *      Group site never answers for Paint Home
 *   4. otherwise                                        → home
 * Pure, so it is unit-tested over host × path. A component that branches on
 * the audience and has no `painthome` arm renders the `home` arm (brief
 * §3): Paint Home is the residential experience with different words.
 */
export const AUDIENCES = ["home", "business", "painthome"] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(v: unknown): v is Audience {
  return v === "home" || v === "business" || v === "painthome";
}

export const AUDIENCE_HEADER = "x-audience";
export const BUSINESS_PREFIX = "/business";
export const PAINTHOME_PREFIX = "/painthome";

/** The commercial hostname (no scheme, no path), lower-cased; null when not configured. */
export function commercialDomain(env: string | undefined = process.env.COMMERCIAL_DOMAIN): string | null {
  const v = (env ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return v || null;
}

/**
 * Paint Home's hostname. The domain is decided (brief §1: painthome.com.au),
 * so unlike the commercial domain it needs no environment variable to
 * resolve — PAINTHOME_DOMAIN only overrides it (a staging host).
 */
export const PAINTHOME_DEFAULT_DOMAIN = "painthome.com.au";
export function paintHomeDomain(env: string | undefined = process.env.PAINTHOME_DOMAIN): string {
  const v = (env ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return v || PAINTHOME_DEFAULT_DOMAIN;
}

const bareHost = (host: string | null | undefined) => (host ?? "").toLowerCase().split(":")[0];

/** localhost, 127.0.0.1 and *.localhost — where a brand's path prefix is served locally instead of redirected. */
export function isLocalHost(host: string | null | undefined): boolean {
  const h = bareHost(host);
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");
}

/** painthome.com.au, www.painthome.com.au, or painthome.localhost (Chromium resolves *.localhost to loopback, so the e2e drives it with no env). */
export function isPaintHomeHost(host: string | null | undefined, domain: string = paintHomeDomain()): boolean {
  const h = bareHost(host);
  return h === domain || h === `www.${domain}` || h === "painthome.localhost";
}

export type Resolution =
  | { audience: Audience; redirect: null; rewrite: string | null }
  | { audience: "business" | "painthome"; redirect: string; rewrite: null };

/** The Paint Home route's own metadata files (app/(marketing)/painthome/opengraph-image.tsx, icon.tsx) — served where Next put them. */
const isRouteFile = (rest: string) => /^\/(opengraph-image|icon)(\.|$|\/)/.test(rest);

/**
 * host + pathname → the audience, and what the proxy must do:
 *  - `redirect`: a 301 target (residential /business… → commercial …;
 *    /painthome… anywhere but a dev host → painthome.com.au …)
 *  - `rewrite`: the internal path to serve (commercial root → /business, the
 *    business homepage route; Paint Home root → /painthome; /business/x or
 *    /painthome/x served locally → /x with the audience header)
 */
export function resolveAudience(
  host: string | null | undefined,
  pathname: string,
  domain: string | null = commercialDomain(),
  painthome: string = paintHomeDomain(),
): Resolution {
  const h = bareHost(host);
  const isPhPath = pathname === PAINTHOME_PREFIX || pathname.startsWith(`${PAINTHOME_PREFIX}/`);
  if (isPaintHomeHost(h, painthome)) {
    // Everything on the Paint Home host is painthome; its root is the Paint Home homepage route.
    if (pathname === "/") return { audience: "painthome", redirect: null, rewrite: PAINTHOME_PREFIX };
    // /painthome on the host itself has one canonical form, the root; the
    // route's own files (/painthome/opengraph-image, /painthome/icon) stay.
    if (pathname === PAINTHOME_PREFIX) return { audience: "painthome", redirect: `https://${painthome}/`, rewrite: null };
    return { audience: "painthome", redirect: null, rewrite: null };
  }
  if (isPhPath) {
    const rest = pathname.slice(PAINTHOME_PREFIX.length) || "/";
    // A dev host serves Paint Home under /painthome (the Settings preview, C1).
    if (isLocalHost(h)) return { audience: "painthome", redirect: null, rewrite: rest === "/" || isRouteFile(rest) ? null : rest };
    return { audience: "painthome", redirect: `https://${painthome}${isRouteFile(rest) ? pathname : rest}`, rewrite: null };
  }
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

/**
 * The residential website's origin, for the cross-domain links and the
 * wizard hand-off from the commercial domain. Its own variable (Tom set
 * NEXT_SITE_URL, 6 Sep — a non-public name, and this is only read on the
 * server): NEXT_PUBLIC_SITE_URL is the PLATFORM address in production
 * (OAuth callbacks, portal links, PDFs) whose root is the login page.
 */
export function residentialOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.NEXT_SITE_URL || env.RESIDENTIAL_SITE_URL || "").trim().replace(/\/$/, "");
  return v || null;
}

/**
 * Where the nav's "For business →" / "For homes →" link goes: the other
 * domain's root, or the local path when no domain is set. Paint Home has no
 * such link — empty (brief §3: the only links to Paint Group are the two
 * "powered by" credits).
 */
export function otherAudienceHref(audience: Audience, domain: string | null = commercialDomain(), residential: string | null = residentialOrigin()): string {
  if (audience === "painthome") return "";
  if (audience === "home") return domain ? `https://${domain}/` : BUSINESS_PREFIX;
  // On the business site → the residential homepage.
  const res = (residential ?? "").replace(/\/$/, "");
  return domain && res ? `${res}/` : "/";
}

/**
 * The path prefix pages on this audience use for their own links (the
 * business site served locally lives under /business). Paint Home's domain
 * always exists, so its pages link bare: on painthome.com.au `/work` is
 * Paint Home's by hostname. Served locally under /painthome (dev, the
 * Settings preview) the deeper links fall to the home site — the same
 * trade-off the business preview makes once its domain is configured.
 */
export function audiencePrefix(audience: Audience, domain: string | null = commercialDomain()): string {
  return audience === "business" && !domain ? BUSINESS_PREFIX : "";
}

/** Entry sources for the wizard hand-off (buckets brief §2.1; Paint Home brief §5): per audience and placement. */
export function entrySourceFor(audience: Audience, where: "hero" | "bottom"): string {
  const base = audience === "business" ? "commercial_home" : audience === "painthome" ? "painthome_home" : "homepage";
  return where === "hero" ? `${base}_hero` : `${base}_cta`;
}
