import { NextResponse } from "next/server";
import { publishedShowcaseJobs } from "@/lib/showcase/queries";
import { commercialDomain, resolveAudience } from "@/lib/marketing/audience";

/**
 * Session 8 §7 — one sitemap per domain, built from the audience: the
 * residential domain lists the home pages and home project pages, the
 * commercial domain the business ones. Read from the host so each domain
 * describes only itself (no page is served on both).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const host = request.headers.get("host");
  const { audience } = resolveAudience(host, "/");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;
  const domain = commercialDomain();
  const business = audience === "business";
  const base = business && !domain ? `${origin}/business` : origin;
  const jobs = (await publishedShowcaseJobs()).filter((j) => j.property_type === (business ? "business" : "home"));
  const urls = [
    { loc: `${base}/`, lastmod: new Date().toISOString().slice(0, 10) },
    { loc: `${base}/work`, lastmod: new Date().toISOString().slice(0, 10) },
    ...jobs.map((j) => ({ loc: `${base}/work/${j.slug}`, lastmod: (j.updated_at || j.published_at || "").slice(0, 10) })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  return new NextResponse(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
