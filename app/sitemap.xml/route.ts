import { NextResponse } from "next/server";
import { paintHomeJobs, publishedShowcaseJobs } from "@/lib/showcase/queries";
import { commercialDomain, paintHomeDomain, resolveAudience } from "@/lib/marketing/audience";
import { PRIVACY_VERSION } from "@/lib/marketing/legal";
import { WARRANTY_TERMS_VERSION } from "@/lib/warranty/terms";
import { newestChange, sitemapXml, type SitemapEntry } from "@/lib/marketing/sitemap";

/**
 * Session 8 §7 — one sitemap per domain, built from the audience: the
 * residential domain lists the home pages and home project pages, the
 * commercial domain the business ones. Read from the host so each domain
 * describes only itself (no page is served on both).
 *
 * SEO foundations (26 Nov 2026): Paint Home's lists what its pages say of
 * themselves (lib/marketing/seo.ts `pageSeo`) — home, /work and the three
 * legal pages — and nothing that is noindex (the wizard, the account, the
 * portal, the login). `lastmod` is the real last change where one is known
 * (the newest job on /work; a legal page's version date) and is left out
 * where it is not, never today's date.
 *
 * ⚑ P9 (24 Oct 2026): Paint Group owns the job pages in search, so a job
 * page's canonical is the Paint Group URL and the Paint Home sitemap names
 * none of them. If Tom replaces P9, the flagged jobs are added HERE and in
 * /work/[slug]'s metadata, from the same list.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const host = request.headers.get("host");
  const { audience } = resolveAudience(host, "/");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const domain = commercialDomain();
  const business = audience === "business";
  const painthome = audience === "painthome";
  const base = painthome ? `https://${paintHomeDomain()}` : business && !domain ? `${origin}/business` : origin;
  const published = await publishedShowcaseJobs();
  const listed = painthome ? paintHomeJobs(published) : published.filter((j) => j.property_type === (business ? "business" : "home"));
  const workChanged = newestChange(listed.map((j) => j.updated_at || j.published_at));
  const urls: SitemapEntry[] = [
    { loc: `${base}/` },
    { loc: `${base}/work`, lastmod: workChanged },
    ...(painthome
      ? [
          { loc: `${base}/privacy`, lastmod: PRIVACY_VERSION },
          { loc: `${base}/terms` },
          { loc: `${base}/warranty`, lastmod: WARRANTY_TERMS_VERSION },
        ]
      : listed.map((j) => ({ loc: `${base}/work/${j.slug}`, lastmod: newestChange([j.updated_at || j.published_at]) }))),
  ];
  return new NextResponse(sitemapXml(urls), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
