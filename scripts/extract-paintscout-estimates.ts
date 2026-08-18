/**
 * Turn PaintScout customer PDFs into regression ground truth.
 *
 * Reads every estimate-*.pdf in regression-set/estimates/ and writes
 * regression-set/ground-truth.json (git-ignored — it carries customer names
 * and addresses, which never enter the repo).
 *
 * What a customer PDF can and cannot give us, learned by reading them:
 *
 *   CAN:  job address · per-area names and prices · countable items with
 *         their counts ("Windows (11)", "Doors (3)") · subtotal, GST, total
 *   CANNOT: m² quantities or hours — those live in PaintScout's internals.
 *         For the 11 workbook jobs we have them from the API extraction; for
 *         PDF-only jobs the gates that need m² wait on that extraction.
 *
 * So the harness scores what the PDF legitimately supports: area count, door
 * count, window count, and (via the workbook where available) quantities.
 *
 *   npx tsx scripts/extract-paintscout-estimates.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname ?? __dirname, "..");
const EST_DIR = path.join(ROOT, "regression-set", "estimates");
const OUT = path.join(ROOT, "regression-set", "ground-truth.json");

type Area = { name: string; priceCents: number; surfaceSummary: string; doors: number; windows: number };
type GroundTruth = {
  file: string;
  estimateId: string | null;
  jobAddress: string | null;
  accepted: boolean;
  jobType: "interior" | "exterior" | "mixed" | "unknown";
  areas: Area[];
  optionAreas: string[];
  subtotalCents: number | null;
  totalCents: number | null;
  doorsTotal: number;
  windowsTotal: number;
};

const money = (s: string): number | null => {
  const m = s.replace(/,/g, "").match(/\$\s*([\d.]+)/);
  return m ? Math.round(Number(m[1]) * 100) : null;
};

/** "Windows (11), Doors (3), Fascias" → counts. A bare mention counts as 1. */
function countItems(summary: string, kind: "door" | "window"): number {
  let n = 0;
  const re = new RegExp(`\\b${kind}s?\\b(?:\\s*\\((\\d+)\\))?`, "gi");
  for (const m of summary.matchAll(re)) n += m[1] ? Number(m[1]) : 1;
  return n;
}

const EXTERIOR_HINTS = /front|back|rear|left side|right side|whole house|fascia|gutter|eave|weatherboard|render|cladding|exterior|roof|fence|deck|pergola/i;
const INTERIOR_HINTS = /bed|kitchen|bath|ensuite|living|lounge|dining|hall|laundry|toilet|wc|study|ceiling|walls|skirting|cornice|interior/i;

async function extractOne(mupdf: typeof import("mupdf"), file: string): Promise<GroundTruth> {
  const doc = mupdf.Document.openDocument(readFileSync(path.join(EST_DIR, file)), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) {
    try { text += doc.loadPage(i).toStructuredText().asText() + "\n"; } catch { /* image page */ }
  }
  const lines = text.split("\n").map((l) => l.trim());

  // Job address: the lines between "Job Address" and the next labelled field.
  let jobAddress: string | null = null;
  const jaIdx = lines.findIndex((l) => /^job address$/i.test(l));
  if (jaIdx >= 0) {
    const take = lines.slice(jaIdx + 1, jaIdx + 5).filter((l) => l && !/^estimate id$/i.test(l));
    // First line is usually "Peter's Address" — keep the street + suburb lines.
    jobAddress = take.filter((l) => !/'s address$/i.test(l)).slice(0, 2).join(", ") || null;
  }

  // The layout interleaves label columns, so the id after "Estimate ID" is
  // unreliable — the filename carries it authoritatively.
  const estimateId = file.match(/estimate-(\d+)/)?.[1] ?? null;

  // Line items: "Name" line followed by a "$price" line, then a surface summary
  // until the next priced item or a totals marker. Options follow the "Options"
  // heading and are excluded from counts.
  const areas: Area[] = [];
  const optionAreas: string[] = [];
  let subtotalCents: number | null = null;
  let totalCents: number | null = null;
  let inOptions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^options$/i.test(line)) { inOptions = true; continue; }
    if (/^sub\s?total$/i.test(line)) { subtotalCents = money(lines[i + 1] ?? "") ?? subtotalCents; continue; }
    if (/^total$/i.test(line)) { totalCents = money(lines[i + 1] ?? "") ?? totalCents; continue; }

    const price = /^\$[\d,.]+$/.test(lines[i + 1] ?? "") ? money(lines[i + 1]) : null;
    if (price != null && line && !/^gst/i.test(line) && !/^sub\s?total$/i.test(line) && !/^total$/i.test(line)) {
      // Collect the summary lines that follow the price.
      const summary: string[] = [];
      for (let j = i + 2; j < Math.min(i + 8, lines.length); j++) {
        const s = lines[j];
        if (!s || /^\$[\d,.]+$/.test(s) || /^(sub\s?total|total|gst|options|add option|item|terms)$/i.test(s)) break;
        if (/^\S.*\$[\d,.]+$/.test(s)) break;
        summary.push(s);
        if ((lines[j + 1] ?? "").match(/^\$[\d,.]+$/)) break;
      }
      const surfaceSummary = summary.join(" ");
      if (inOptions) {
        optionAreas.push(line);
      } else {
        areas.push({
          name: line,
          priceCents: price,
          surfaceSummary,
          doors: countItems(surfaceSummary, "door"),
          windows: countItems(surfaceSummary, "window"),
        });
      }
      i += 1;
    }
  }

  const joined = areas.map((a) => `${a.name} ${a.surfaceSummary}`).join(" ");
  const ext = EXTERIOR_HINTS.test(joined);
  const int = INTERIOR_HINTS.test(joined);
  const jobType = ext && int ? "mixed" : ext ? "exterior" : int ? "interior" : "unknown";

  return {
    file,
    estimateId,
    jobAddress,
    accepted: /\bAccepted\b/.test(text.slice(0, 600)),
    jobType,
    areas,
    optionAreas,
    subtotalCents,
    totalCents,
    doorsTotal: areas.reduce((n, a) => n + a.doors, 0),
    windowsTotal: areas.reduce((n, a) => n + a.windows, 0),
  };
}

async function main() {
  const mupdf = (await import("mupdf")) as typeof import("mupdf");
  const files = readdirSync(EST_DIR).filter((f) => f.endsWith(".pdf")).sort();
  const out: GroundTruth[] = [];
  for (const f of files) {
    const gt = await extractOne(mupdf, f);
    out.push(gt);
    console.log(
      `${(gt.estimateId ?? "????").padEnd(6)} ${(gt.jobAddress ?? "ADDRESS NOT FOUND").padEnd(42)} ` +
      `${gt.jobType.padEnd(9)} areas=${String(gt.areas.length).padStart(2)} ` +
      `doors=${String(gt.doorsTotal).padStart(3)} windows=${String(gt.windowsTotal).padStart(3)} ` +
      `total=${gt.totalCents != null ? "$" + (gt.totalCents / 100).toFixed(2) : "?"}${gt.accepted ? " ACCEPTED" : ""}`,
    );
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n${out.length} estimates -> ${OUT}`);
}

main();
