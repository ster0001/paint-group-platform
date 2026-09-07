import { stripFrontMatter } from "./markdown";

/**
 * A guided tour is help content: docs/help/_tours/<role>.md, one `##` card
 * after another, each with a `target:` line naming the portal route it
 * points at and a short plain-English body. Pure parser, unit-tested;
 * scripts/help-index.ts validates the same shape in CI.
 */
export type TourCard = { title: string; target: string; body: string };

export function parseTour(src: string): TourCard[] {
  const cards: TourCard[] = [];
  let current: TourCard | null = null;
  for (const raw of stripFrontMatter(src).replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { current = { title: h[1].trim(), target: "", body: "" }; cards.push(current); continue; }
    if (!current) continue;
    const t = /^target:\s*(\S+)\s*$/.exec(line);
    if (t) { current.target = t[1]; continue; }
    if (line) current.body = current.body ? `${current.body} ${line}` : line;
  }
  return cards;
}

/** Problems a card set has — empty when it is fit to show. */
export function tourProblems(cards: TourCard[]): string[] {
  const out: string[] = [];
  if (cards.length === 0) out.push("no cards (each card is a `## Title` followed by a `target:` line and a sentence or two)");
  cards.forEach((c, i) => {
    if (!c.target.startsWith("/")) out.push(`card ${i + 1} "${c.title}": target must be a route starting with /`);
    if (!c.body) out.push(`card ${i + 1} "${c.title}": no body text`);
  });
  return out;
}
