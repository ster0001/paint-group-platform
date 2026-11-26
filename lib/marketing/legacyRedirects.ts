/**
 * Paint Home SEO foundations (26 Nov 2026) — the old Paint Home WordPress
 * site's addresses, which Google still lists, sent for good to the page that
 * replaced each. Paint Home's host only (lib/marketing/audience.ts calls
 * this inside its Paint Home branch; the Paint Group site never sees it).
 *
 * A TABLE on purpose: Tom will add more old addresses from Search Console —
 * one row each. `under: true` also catches everything below the address
 * (`/portfolio/kitchens`, `/blog/any-post`).
 *
 * ⚑ D11: `/referral` goes to the home page until Tom says whether the
 * referral offer still runs.
 */
export type LegacyRedirect = { from: string; to: string; under?: boolean };

export const PAINTHOME_LEGACY_REDIRECTS: LegacyRedirect[] = [
  { from: "/guarantee", to: "/warranty" },
  // A contact page comes in Phase 2; until then the call line at the foot of the home page.
  { from: "/contact-us", to: "/#contact" },
  { from: "/portfolio", to: "/work", under: true },
  { from: "/blog", to: "/", under: true },
  { from: "/referral", to: "/" },
];

/** The new path for an old one, or null. A trailing slash and letter case make no difference. */
export function legacyRedirectFor(pathname: string, table: LegacyRedirect[] = PAINTHOME_LEGACY_REDIRECTS): string | null {
  const path = (pathname.replace(/\/+$/, "") || "/").toLowerCase();
  for (const r of table) {
    if (path === r.from || (r.under && path.startsWith(`${r.from}/`))) return r.to;
  }
  return null;
}
