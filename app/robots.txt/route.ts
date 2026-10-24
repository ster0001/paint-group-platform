import { NextResponse } from "next/server";
import { isPaintHomeHost, paintHomeDomain, resolveAudience } from "@/lib/marketing/audience";
import { isMarketingHost } from "@/lib/marketing/hosts";

/**
 * Paint Home brief §7 — a robots file per site, decided by the host like the
 * sitemap is. Each site names only its own sitemap, and each follows its own
 * index switch: Paint Home `PAINTHOME_INDEXABLE=1`, Paint Group
 * `SITE_INDEXABLE=1` (the `X-Robots-Tag` header in next.config.ts is the
 * belt to this brace). The platform address (login) is never indexed.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const painthome = isPaintHomeHost(host);
  const marketing = isMarketingHost(host);
  const indexable = painthome ? process.env.PAINTHOME_INDEXABLE === "1" : marketing && process.env.SITE_INDEXABLE === "1";
  const origin = painthome ? `https://${paintHomeDomain()}` : `${proto}://${host}`;
  const { audience } = resolveAudience(host, "/");
  const lines = indexable
    ? ["User-agent: *", "Allow: /", "Disallow: /e/", "Disallow: /i/", "Disallow: /w/", "Disallow: /estimate", "Disallow: /account", "Disallow: /portal", "Disallow: /login", `Sitemap: ${origin}/sitemap.xml`]
    : ["User-agent: *", "Disallow: /"];
  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", "x-audience": audience },
  });
}
