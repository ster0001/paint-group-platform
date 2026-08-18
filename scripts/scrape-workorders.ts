/**
 * Scrape PaintScout work-order share links into regression ground truth.
 *
 * Why a browser and not the API: the PaintScout GraphQL viewQuote call resists
 * replay outside their app (urlDoc handshake), but the rendered share page
 * prints EVERYTHING we need - total hours, wall/ceiling m2, lineal metres and
 * per-line quantities - so we load each link headless and parse the rendered
 * text. Raw text is saved per job so the parser can be improved and re-run
 * without reloading pages (each load may register a "viewed" event on the
 * PaintScout side).
 *
 *   npx tsx scripts/scrape-workorders.ts            # all links, skipping ones already scraped
 *   FORCE=1 JOB_IDS=3109 npx tsx scripts/scrape-workorders.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = path.join(import.meta.dirname ?? __dirname, "..");
const SET = path.join(ROOT, "regression-set");
const RAW_DIR = path.join(SET, "work-orders");
const OUT = path.join(SET, "work-order-truth.json");

type Item = { area: string | null; name: string; qty: number; unit: "count" | "m2" | "m"; hours: number | null };
type AreaTotal = { area: string; prep: number; painting: number; total: number };
type Parsed = {
  key: string;
  url: string;
  scrapedAt: string;
  estimateId: string | null;
  jobAddress: string | null;
  totalHours: number | null;
  /** true when totalHours was summed from per-item hours because the page omitted the banner */
  totalHoursDerived?: boolean;
  /** the "Total Dimensions (m²)" block, e.g. { Walls: 435, Ceilings: 210, m: 65 } - "m" is lineal metres */
  totalDimensions: Record<string, number>;
  /**
   * PaintScout prints each area's own L x W x H under its heading, e.g.
   * "(4'x3.7'x3')" - metres despite the foot marks. Real per-room dimensions
   * INCLUDING true ceiling heights: the strongest per-room truth in the data.
   */
  areaDimensions: Record<string, { L: number; W: number; H: number }>;
  areaTotals: AreaTotal[];
  items: Item[];
  optionAreas: string[];
  error?: string;
};

/**
 * The rendered page's shape (verified on estimate 3109):
 *   "Estimate ID" \n "3109"
 *   "Job Address" \n "<name>'s Address" \n street \n suburb
 *   "Total Dimensions (m²)" \n "Walls: 435" \n "m: 65" \n ... until "Areas"
 *   area heading \n "(15'x9')"? \n "hr" \n items... \n "Total" \n "Prep: 4.25" "+" "Painting: 36" "=" "40.25"
 *   items look like "Windows (3)", "Weatherboards (135m²)", "Soffits / Eaves (15m)",
 *   each followed a few lines later by a bare hours number.
 *   "Options" ends the counted region (optional items excluded, same rule as the PDFs).
 */
function parseText(key: string, url: string, text: string): Parsed {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const after = (marker: RegExp): string | null => {
    const i = lines.findIndex((l) => marker.test(l));
    return i >= 0 ? lines[i + 1] ?? null : null;
  };

  const estimateId = after(/^Estimate ID$/i);
  let jobAddress: string | null = null;
  const jaIdx = lines.findIndex((l) => /^Job Address$/i.test(l));
  if (jaIdx >= 0) {
    jobAddress = lines.slice(jaIdx + 1, jaIdx + 5)
      .filter((l) => l && !/'s Address$/i.test(l) && !/^Estimate ID$/i.test(l))
      .slice(0, 2).join(", ") || null;
  }
  const thIdx = lines.findIndex((l) => /^Total Hours$/i.test(l));
  const totalHours = thIdx >= 0 && /^[\d,.]+$/.test(lines[thIdx + 1] ?? "") ? Number(lines[thIdx + 1].replace(/,/g, "")) : null;

  const totalDimensions: Record<string, number> = {};
  const tdIdx = lines.findIndex((l) => /^Total Dimensions/i.test(l));
  if (tdIdx >= 0) {
    for (let i = tdIdx + 1; i < lines.length && !/^Areas$/i.test(lines[i]); i++) {
      const m = lines[i].match(/^([A-Za-z][A-Za-z /'-]*):\s*([\d,]+(?:\.\d+)?)$/);
      if (m) totalDimensions[m[1]] = Number(m[2].replace(/,/g, ""));
      else break;
    }
  }

  // Walk the Areas region: track the current area heading (a line followed by
  // "hr", optionally with a "(WxH)" line between), collect item lines and the
  // per-area Total blocks. Stop counting at Options/Media.
  const items: Item[] = [];
  const areaTotals: AreaTotal[] = [];
  const areaDimensions: Record<string, { L: number; W: number; H: number }> = {};
  const optionAreas: string[] = [];
  const areasIdx = lines.findIndex((l) => /^Areas$/i.test(l));
  let currentArea: string | null = null;
  let inOptions = false;
  const itemRe = /^(.{2,50}?)\s*\((\d+(?:\.\d+)?)\s*(m²|m2|m)?\)$/;
  const dimsRe = /^\(([\d.]+)'?\s*x\s*([\d.]+)'?\s*x\s*([\d.]+)'?\)$/i;

  for (let i = Math.max(areasIdx, 0); i < lines.length; i++) {
    const l = lines[i];
    if (/^Options$/i.test(l)) { inOptions = true; continue; }
    if (/^Media$/i.test(l)) break;
    if (inOptions) {
      if (/^Add Option$/i.test(l) && lines[i - 2]) optionAreas.push(`${lines[i - 2]}`);
      continue;
    }
    // The room's own dims line sits between its heading and "hr" - record it
    // against the heading, and never treat it as a heading itself.
    const dm = l.match(dimsRe);
    if (dm) {
      if (currentArea && lines[i - 1] === currentArea) {
        areaDimensions[currentArea] = { L: Number(dm[1]), W: Number(dm[2]), H: Number(dm[3]) };
      }
      continue;
    }
    if (lines[i + 1] === "hr" || (lines[i + 2] === "hr" && /^\(.+\)$/.test(lines[i + 1] ?? ""))) {
      if (!/^Total$/i.test(l) && !itemRe.test(l) && !/^\(/.test(l)) { currentArea = l; continue; }
    }
    if (/^Total$/i.test(l) && currentArea) {
      // "Prep: X" "+" "Painting: Y" "=" "Z"  (prep block absent when zero)
      const seg = lines.slice(i + 1, i + 6).join(" ");
      const prep = Number(seg.match(/Prep:\s*([\d.]+)/)?.[1] ?? 0);
      const painting = Number(seg.match(/Painting:\s*([\d.]+)/)?.[1] ?? 0);
      const total = Number(seg.match(/=\s*([\d.]+)/)?.[1] ?? prep + painting);
      areaTotals.push({ area: currentArea, prep, painting, total });
      continue;
    }
    const m = l.match(itemRe);
    if (m && !/^\(/.test(l)) {
      // hours: the next bare number line before the following item/Total.
      let hours: number | null = null;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (/^[\d.]+$/.test(lines[j]) && !/Litre/.test(lines[j - 1] ?? "")) { hours = Number(lines[j]); break; }
        if (/^Total$/i.test(lines[j]) || itemRe.test(lines[j])) break;
      }
      const unit = m[3] ? (m[3] === "m" ? "m" : "m2") : "count";
      items.push({ area: currentArea, name: m[1].trim(), qty: Number(m[2]), unit, hours });
    }
  }

  // Some share variants (e.g. estimate 2688) omit the Total Hours banner and
  // per-area totals; per-item hours still print, so derive the total from them
  // and mark it as derived rather than leaving the job unusable.
  let derived: number | null = null;
  if (totalHours == null && items.some((it) => it.hours != null)) {
    derived = Math.round(items.reduce((n, it) => n + (it.hours ?? 0), 0) * 100) / 100;
  }

  return { key, url, scrapedAt: new Date().toISOString(), estimateId, jobAddress, totalHours: totalHours ?? derived, totalHoursDerived: derived != null, totalDimensions, areaDimensions, areaTotals, items, optionAreas };
}

async function main() {
  const { links } = JSON.parse(readFileSync(path.join(SET, "work-order-links.json"), "utf8")) as {
    links: Record<string, string>;
  };
  mkdirSync(RAW_DIR, { recursive: true });

  const only = process.env.JOB_IDS ? new Set(process.env.JOB_IDS.split(",")) : null;
  const force = !!process.env.FORCE;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results: Parsed[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Parsed[]) : [];
  const byKey = new Map(results.map((r) => [r.key, r]));

  for (const [key, rawUrl] of Object.entries(links)) {
    if (only && !only.has(key)) continue;
    const url = rawUrl.replace(/\/$/, "");
    const rawPath = path.join(RAW_DIR, `${key}.txt`);

    let text: string;
    if (!force && existsSync(rawPath)) {
      text = readFileSync(rawPath, "utf8"); // reparse without reloading (avoids extra "viewed" events)
      process.stdout.write(`${key.padEnd(16)} (cached) `);
    } else {
      process.stdout.write(`${key.padEnd(16)} loading… `);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // The page is client-rendered; wait until real content (hours or a
        // decent amount of text) appears rather than a fixed sleep.
        await page.waitForFunction(
          () => /hours|hrs|work order/i.test(document.body.innerText) && document.body.innerText.length > 500,
          { timeout: 45_000 },
        ).catch(() => {});
        await page.waitForTimeout(2_500); // let late chunks (dimension tables) settle
        text = await page.evaluate(() => document.body.innerText);
        writeFileSync(rawPath, text);
      } catch (e) {
        console.log(`FAILED: ${(e as Error).message.split("\n")[0]}`);
        byKey.set(key, { key, url, scrapedAt: new Date().toISOString(), estimateId: null, jobAddress: null, totalHours: null, totalDimensions: {}, areaDimensions: {}, areaTotals: [], items: [], optionAreas: [], error: (e as Error).message.split("\n")[0] });
        continue;
      }
    }

    const parsed = parseText(key, url, text);
    byKey.set(key, parsed);
    console.log(`est=${parsed.estimateId ?? "?"} hours=${parsed.totalHours ?? "?"} dims=${JSON.stringify(parsed.totalDimensions)} items=${parsed.items.length} areas=${parsed.areaTotals.length}`);
  }

  const out = [...byKey.values()];
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n${out.length} work orders -> ${OUT} (raw text in regression-set/work-orders/)`);
  await browser.close();
}

main();
