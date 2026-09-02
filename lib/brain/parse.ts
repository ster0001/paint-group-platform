/**
 * The Brain seed (docs/brain/brain-v1.md) → rows for brain_entries, and the
 * live-value rendering the [PLATFORM] entries need (D14, import notes 2–3).
 *
 * Entry format in the file:  `### slug · "Question" · audience: x` (or
 * `· audience` on a short line), then the answer paragraph(s). A bold
 * **[TOM TO WRITE]** marker means the answer is a placeholder — imported with
 * needs_content=true and never served. **[PLATFORM …]** means the wording is
 * drafted from platform rulings; still a draft until Tom approves.
 *
 * Settings tokens: `{{deposit_pct}}`, `{{validity_days}}`, `{{service_area}}`,
 * `{{warranty_years}}` — rendered at answer time from the live rows, never
 * baked into the stored text.
 */

export type BrainSeedEntry = {
  slug: string;
  topic: string;
  question: string;
  answerMd: string;
  audience: "customer" | "staff" | "both";
  needsContent: boolean;
  /** The seed's provenance marker, for the approval screen. */
  marker: "platform" | "tom_to_write" | "plain";
};

const HEADING = /^###\s+([a-z0-9-]+)\s*·\s*"([^"]+)"\s*·\s*(?:audience:\s*)?(customer|staff|both)\s*(?:—.*)?$/i;

export function parseBrainSeed(md: string): BrainSeedEntry[] {
  const lines = md.split("\n");
  const out: BrainSeedEntry[] = [];
  let topic = "";
  let current: BrainSeedEntry | null = null;
  let body: string[] = [];
  const flush = () => {
    if (!current) return;
    const text = body.join("\n").trim();
    const tomToWrite = /\*\*\[TOM TO WRITE\]\*\*/.test(text) || /\*\*\[TOM TO WRITE\]/.test(current.answerMd);
    const platform = /\*\*\[PLATFORM[^\]]*\]\*\*/.test(text);
    const answer = text
      .replace(/\*\*\[TOM TO WRITE\]\*\*\s*—?\s*/g, "")
      .replace(/\*\*\[PLATFORM[^\]]*\]\*\*\s*/g, "")
      .trim();
    out.push({ ...current, answerMd: tomToWrite ? (answer || "Not written yet.") : answer, needsContent: tomToWrite, marker: tomToWrite ? "tom_to_write" : platform ? "platform" : "plain" });
    current = null; body = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^##\s+/.test(line) && !/^###/.test(line)) { flush(); topic = line.replace(/^##\s+/, "").trim(); continue; }
    const h = line.match(HEADING);
    if (h) {
      flush();
      current = { slug: h[1].toLowerCase(), topic, question: h[2].trim(), answerMd: "", audience: h[3].toLowerCase() as BrainSeedEntry["audience"], needsContent: false, marker: "plain" };
      // A one-line entry: "### slug · "Q" · customer — **[TOM TO WRITE]** (note)"
      const tail = line.slice(line.indexOf(h[3]) + h[3].length).replace(/^\s*—\s*/, "").trim();
      if (tail) body.push(tail);
      continue;
    }
    if (/^---\s*$/.test(line) || /^## Import instructions/i.test(line)) { flush(); if (/Import/i.test(line)) break; continue; }
    if (current) body.push(line);
  }
  flush();
  return out;
}

export type LiveValues = { depositPct: number; validityDays: number; serviceArea: string; warrantyYears: number };

export const DEFAULT_LIVE_VALUES: LiveValues = { depositPct: 10, validityDays: 60, serviceArea: "within about 50 km of Melbourne", warrantyYears: 2 };

/** Replace the Settings tokens; unknown tokens are left visible so a typo is
 *  seen, not silently blanked. */
export function renderBrainAnswer(answerMd: string, live: LiveValues): string {
  return answerMd
    .replace(/\{\{\s*deposit_pct\s*\}\}/g, String(live.depositPct))
    .replace(/\{\{\s*validity_days\s*\}\}/g, String(live.validityDays))
    .replace(/\{\{\s*service_area\s*\}\}/g, live.serviceArea)
    .replace(/\{\{\s*warranty_years\s*\}\}/g, String(live.warrantyYears));
}

/** Where the seed states a figure that is really a Settings value, swap in
 *  the token so the live number renders (import note 3). */
export function tokeniseSeedAnswer(slug: string, answerMd: string): string {
  if (slug === "price-validity") return answerMd.replace(/\b60 days\b/, "{{validity_days}} days");
  if (slug === "service-area") return answerMd.replace(/Within ~50 km of Melbourne\./i, "{{service_area}}.");
  if (slug === "deposit") return `${answerMd}\n\nThe deposit is {{deposit_pct}}% of the estimate total.`;
  if (slug === "warranty") return answerMd.replace(/\b2-year\b/, "{{warranty_years}}-year");
  return answerMd;
}

/** Settings rows → the live values (defaults when a row is absent). */
export function liveValuesFrom(settings: ReadonlyArray<{ key: string; value: unknown }>): LiveValues {
  const get = (k: string) => (settings.find((s) => s.key === k)?.value ?? {}) as Record<string, unknown>;
  const invoicing = get("invoicing");
  const templates = get("estimate_templates");
  const area = get("service_area");
  const warranty = get("warranty_terms");
  const postcodes = Array.isArray(area.postcodes) ? (area.postcodes as string[]) : [];
  return {
    depositPct: typeof invoicing.depositPct === "number" ? invoicing.depositPct : DEFAULT_LIVE_VALUES.depositPct,
    validityDays: typeof templates.validDays === "number" ? templates.validDays : DEFAULT_LIVE_VALUES.validityDays,
    serviceArea: typeof area.description === "string" && area.description ? area.description : postcodes.length ? `the postcodes we cover (${postcodes.length} of them — ask us about yours)` : DEFAULT_LIVE_VALUES.serviceArea,
    warrantyYears: typeof warranty.years === "number" ? warranty.years : DEFAULT_LIVE_VALUES.warrantyYears,
  };
}

/** Words that carry no topic — a question and an entry sharing only these
 *  do not match ("how do you…" would otherwise hit every entry). */
const STOP = new Set(["how", "what", "when", "where", "which", "does", "do", "did", "you", "your", "the", "and", "for", "with", "that", "this", "there", "have", "has", "give", "get", "can", "will", "much", "many", "about", "handle", "deal", "should", "would", "could", "our", "are", "was", "were", "its", "it's", "any", "all", "need", "want", "tell", "know", "please", "estimate", "quote", "paint", "painting", "painted", "job", "house", "home"]);

export function contentWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

/** Keep only entries whose topic/question/slug shares a content word with
 *  the query — the retrieval layer's honesty filter, shared by every store. */
export function relevantHits<T extends { slug: string | null; topic: string; question: string }>(query: string, hits: T[]): T[] {
  const q = contentWords(query);
  if (q.length === 0) return [];
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
  const qs = q.map(stem);
  return hits
    .map((h) => ({ h, score: contentWords(`${h.slug?.replace(/-/g, " ") ?? ""} ${h.topic} ${h.question}`).map(stem).filter((w) => qs.includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.h);
}
