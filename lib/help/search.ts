/**
 * Help search (brief Phase C, session C2) — pure ranking over documents the
 * caller has ALREADY role-filtered. Nothing here knows about sessions; the
 * route decides what goes in, so a contractor query can only ever be ranked
 * against contractor guides.
 *
 * Every term must appear somewhere (title, summary or body, case-insensitive,
 * accent- and dash-insensitive). Rank: title hits, then summary, then how many
 * times the body mentions the terms. The snippet is the first sentence of the
 * body that carries a term, so the reader sees why it matched.
 */

export type SearchDoc = { key: string; title: string; summary: string; text: string };
export type SearchHit = { key: string; score: number; snippet: string };

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[—–]/g, "-").toLowerCase();

export function searchTerms(q: string): string[] {
  return fold(q).split(/[^a-z0-9%$.-]+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, "")).filter((t) => t.length >= 2).slice(0, 8);
}

function count(hay: string, needle: string): number {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

export function searchIn(q: string, docs: SearchDoc[], limit = 20): SearchHit[] {
  const terms = searchTerms(q);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const title = fold(d.title), summary = fold(d.summary), body = fold(d.text);
    const all = `${title} ${summary} ${body}`;
    if (!terms.every((t) => all.includes(t))) continue;
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 20;
      if (summary.includes(t)) score += 8;
      score += Math.min(count(body, t), 12);
    }
    const sentence = sentences(d.text).find((s) => terms.some((t) => fold(s).includes(t))) ?? d.summary;
    hits.push({ key: d.key, score, snippet: sentence.length > 220 ? sentence.slice(0, 217) + "…" : sentence });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
