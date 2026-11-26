/**
 * The sitemap's two pure pieces (SEO foundations, 26 Nov 2026).
 *
 * `lastmod` is a full W3C timestamp when it comes from a row (so no
 * calendar-day bucketing, and no UTC-date-for-a-Melbourne-day mistake), or a
 * plain `YYYY-MM-DD` when it is a document's version date. Unknown = absent.
 */
export type SitemapEntry = { loc: string; lastmod?: string | null };

/** The latest of some timestamps, as an ISO string; null when none parses. */
export function newestChange(stamps: Array<string | null | undefined>): string | null {
  let best = -Infinity;
  for (const s of stamps) {
    const t = s ? Date.parse(s) : NaN;
    if (!Number.isNaN(t) && t > best) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sitemapXml(urls: SitemapEntry[]): string {
  const rows = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}
