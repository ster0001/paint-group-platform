import type { Metadata } from "next";
import type { Audience } from "./audience";
import type { Brand } from "./brand";

/**
 * Paint Home SEO foundations (26 Nov 2026) — ONE place decides whether a
 * shopfront's pages may be indexed and which host their canonical names, so
 * a page never hard-codes either. Pure: the page hands in its audience, its
 * brand and its own path.
 *
 * - Paint Home's switch is `PAINTHOME_INDEXABLE=1`, Paint Group's is
 *   `SITE_INDEXABLE=1` (the same two switches robots.txt and the
 *   `X-Robots-Tag` rules in next.config.ts read). Neither is changed here.
 * - A Paint Home page names itself on Paint Home's domain. A Paint Group
 *   page gets nothing from this helper: it keeps the marketing layout's
 *   noindex until the Paint Group switch-over, exactly as before.
 * - ⚑ P9 (24 Oct 2026, "Paint Group owns the job pages in search") is NOT
 *   decided here: /work/[slug] does not call this until Tom rules on it.
 */
export function brandIndexable(audience: Audience, env: Record<string, string | undefined> = process.env): boolean {
  return audience === "painthome" ? env.PAINTHOME_INDEXABLE === "1" : env.SITE_INDEXABLE === "1";
}

/** `/work` → `https://painthome.com.au/work`; the root keeps its slash. */
export function canonicalUrl(brand: Pick<Brand, "url">, path: string): string {
  const p = path === "" || path === "/" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`;
  return `${brand.url}${p}`;
}

/** The robots, canonical and base a page on this audience spreads into its metadata. Empty for Paint Group. */
export function pageSeo(audience: Audience, brand: Pick<Brand, "url">, path: string, env: Record<string, string | undefined> = process.env): Pick<Metadata, "metadataBase" | "alternates" | "robots"> {
  if (audience !== "painthome") return {};
  const on = brandIndexable(audience, env);
  return { metadataBase: new URL(brand.url), alternates: { canonical: canonicalUrl(brand, path) }, robots: { index: on, follow: on } };
}
