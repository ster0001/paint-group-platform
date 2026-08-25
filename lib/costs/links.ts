/**
 * Document links inside an inbound email — the Dulux shape: no attachment,
 * just "click here to view your invoice". Pure ranking; the guarded fetch
 * lives in fetchDoc.ts.
 *
 * An emailed link is UNTRUSTED DATA. Nothing here follows anything — it only
 * proposes candidates, https-only, ranked by how strongly the link presents
 * itself as a document.
 */

export type DocLink = { url: string; score: number };

const DOCISH = /invoice|download|view|open|statement|bill|docket|receipt/i;

function scoreOf(url: string, label: string, context = ""): number {
  let score = 0;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return 0;
    if (/\.pdf(\?|$)/i.test(u.pathname)) score += 4; // a direct PDF beats any label
    if (DOCISH.test(u.pathname + u.search)) score += 1;
  } catch {
    return 0;
  }
  if (DOCISH.test(label)) score += 2;
  // The "click here" shape: the label says only "here" and the words around
  // the anchor say what "here" opens (real Dulux emails do exactly this).
  else if (/^(click\s+)?here\b/i.test(label) && DOCISH.test(context)) score += 2;
  // Plumbing links that never carry a document.
  if (/unsubscribe|privacy|preferences|facebook|twitter|linkedin|instagram|maps\.google/i.test(url)) return 0;
  return score;
}

/** Ranked candidate document links from an email's html + text, best first. */
export function candidateDocLinks(html: string, text: string, limit = 5): string[] {
  const seen = new Map<string, number>();

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    const url = m[1].trim();
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const context = html
      .slice(Math.max(0, (m.index ?? 0) - 250), m.index ?? 0)
      .replace(/<[^>]+>/g, " ");
    const s = scoreOf(url, label, context);
    if (s > 0) seen.set(url, Math.max(seen.get(url) ?? 0, s));
  }
  for (const m of text.matchAll(/https:\/\/[^\s<>"'\])]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const s = scoreOf(url, "");
    if (s > 0) seen.set(url, Math.max(seen.get(url) ?? 0, s));
  }

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}
