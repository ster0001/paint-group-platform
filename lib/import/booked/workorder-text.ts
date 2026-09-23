/**
 * Part C · the PaintScout WORK-ORDER page, as text, → the areas and lines the
 * builder needs (Tom's C-1 ruling, 16 Sep 2026: a handover job arrives with
 * the quote's area prices and no per-line hours; the hours live on the work
 * order). PaintScout's API resists replay outside their app, but the rendered
 * share page prints everything: every area, every line with its quantity,
 * coats, product and hours, the per-area prep/painting split and the job's
 * total hours. The regression scraper (scripts/scrape-workorders.ts) reads the
 * same page for the same reason; this is the loader's own reading of it.
 *
 * Pure. Given `document.body.innerText` (or the text a browser copied out),
 * it returns what it can prove from the page and REFUSES nothing here — the
 * caller decides what a missing total or an unmatched area means. Nothing
 * customer-facing is parsed: the contact block is skipped on purpose.
 *
 * The page's shape (verified on quotes 3613, 3639 and 3688, 22 Sep 2026):
 *
 *   "Estimate ID" ↵ "3613"                       the quote number
 *   "Total Hours" ↵ "84"                         the job's hours
 *   "Product Description" ↵ "Dulux Weathershield  (Estimated: 38 Litre - $874.00)" …
 *   "Total Dimensions (m²)" ↵ "Walls: 24.8" ↵ "m: 62"
 *   "Areas"
 *     heading ↵ ["(15'x3')"] ↵ "hr"             an area; the dims are metres despite the foot marks
 *       "Soffits / Eaves (15m)"                  a line: name (quantity[unit])
 *       "Eaves - Prep: 1 + Labor: 3"             free text (a size, a prep split…)
 *       "Dulux Weathershield  - 1.88 Litre - $43.12"   the product on the line
 *       "Coats: 2"
 *       "4"                                      the line's hours
 *       …
 *     "Total" ↵ "Prep: 4" ↵ "+" ↵ "Painting: 17" ↵ "=" ↵ "21"   (the Prep block is absent when zero)
 *     heading ↵ "hr" ↵ description… ↵ "3" ↵ "Total" ↵ "Painting: 3" ↵ "=" ↵ "3"   crew work with no lines
 *     heading ↵ "hr" ↵ description… ↵ "Total"   a heading with neither lines nor hours
 *   "Options" … "Media" …                        not part of the job: ignored
 */

export type ParsedWorkOrderItem = {
  item: string;
  qty: number | null;
  unit: "m2" | "m" | "count";
  coats: number | null;
  hours: number | null;
  product: string;
  /** Litres PaintScout allowed for this line, when printed. */
  litres: number | null;
};

export type ParsedWorkOrderArea = {
  name: string;
  length_m: number | null;
  width_m: number | null;
  height_m: number | null;
  /** The area's Total block; all null when the page printed none. */
  hours_prep: number | null;
  hours_paint: number | null;
  hours_total: number | null;
  items: ParsedWorkOrderItem[];
};

export type ParsedWorkOrder = {
  quoteNo: string | null;
  /** The "Total Hours" banner; null when the page omitted it. */
  totalHours: number | null;
  /** Sum of every line's hours plus the total of every hours-only area — the figure the builder will carry. */
  hoursFromLines: number;
  materials: Array<{ product: string; litres: number | null }>;
  totalDimensions: Record<string, number>;
  areas: ParsedWorkOrderArea[];
  /** Headings printed under "Options" — priced extras the customer did not take. Never imported. */
  optionHeadings: string[];
};

const itemRe = /^(.{2,60}?)\s*\((\d+(?:\.\d+)?)\s*(m²|m2|m)?\)$/;
const dimsRe = /^\(([\d.]+)'?\s*x\s*([\d.]+)'?(?:\s*x\s*([\d.]+)'?)?\)$/i;
const bareNumber = /^\d+(?:\.\d+)?$/;
const productLineRe = /^(.+?)\s+-\s+([\d.]+)\s*litres?\s+-\s+\$/i;
const materialRe = /^(.+?)\s*\(Estimated:\s*([\d.]+)\s*litres?\b.*\)$/i;

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseWorkOrderText(text: string): ParsedWorkOrder {
  const lines = text.split("\n").map((l) => l.replace(/ /g, " ").trim()).filter(Boolean);
  const indexOf = (re: RegExp, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));

  const idIdx = indexOf(/^Estimate ID$/i);
  const quoteNo = idIdx >= 0 && /^\d{1,20}$/.test(lines[idIdx + 1] ?? "") ? lines[idIdx + 1] : null;
  const thIdx = indexOf(/^Total Hours$/i);
  const totalHours = thIdx >= 0 ? num(bareNumber.test(lines[thIdx + 1] ?? "") ? lines[thIdx + 1] : null) : null;

  // Product Description → materials (until the next section heading).
  const materials: ParsedWorkOrder["materials"] = [];
  const pdIdx = indexOf(/^Product Description$/i);
  if (pdIdx >= 0) {
    for (let i = pdIdx + 1; i < lines.length && !/^(Total Dimensions|Areas)\b/i.test(lines[i]); i++) {
      const m = lines[i].match(materialRe);
      if (m) materials.push({ product: m[1].trim(), litres: num(m[2]) });
    }
  }

  const totalDimensions: Record<string, number> = {};
  const tdIdx = indexOf(/^Total Dimensions/i);
  if (tdIdx >= 0) {
    for (let i = tdIdx + 1; i < lines.length && !/^Areas$/i.test(lines[i]); i++) {
      const m = lines[i].match(/^([A-Za-z][A-Za-z /'-]*):\s*([\d,]+(?:\.\d+)?)$/);
      if (!m) break;
      totalDimensions[m[1]] = num(m[2]) ?? 0;
    }
  }

  const areas: ParsedWorkOrderArea[] = [];
  const optionHeadings: string[] = [];
  const areasIdx = indexOf(/^Areas$/i);
  if (areasIdx < 0) {
    return { quoteNo, totalHours, hoursFromLines: 0, materials, totalDimensions, areas, optionHeadings };
  }

  // A heading is a line followed by "hr", or by its dims and then "hr".
  const isHeadingAt = (i: number): boolean => {
    const l = lines[i];
    if (!l || /^Total$/i.test(l) || itemRe.test(l) || /^\(/.test(l) || bareNumber.test(l)) return false;
    if (lines[i + 1] === "hr") return true;
    return dimsRe.test(lines[i + 1] ?? "") && lines[i + 2] === "hr";
  };

  let current: ParsedWorkOrderArea | null = null;
  let inOptions = false;
  for (let i = areasIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^Media$/i.test(l) || /^Amazing On-Site Estimation$/i.test(l)) break;
    if (/^Options$/i.test(l)) { inOptions = true; current = null; continue; }
    if (inOptions) {
      if (isHeadingAt(i) || (/^\$[\d,.]+$/.test(lines[i + 1] ?? "") && !/^\$/.test(l) && !/^Item$/i.test(l))) optionHeadings.push(l);
      continue;
    }

    if (isHeadingAt(i)) {
      const dm = lines[i + 1]?.match(dimsRe);
      current = {
        name: l, length_m: dm ? num(dm[1]) : null, width_m: dm ? num(dm[2]) : null, height_m: dm && dm[3] ? num(dm[3]) : null,
        hours_prep: null, hours_paint: null, hours_total: null, items: [],
      };
      areas.push(current);
      i += dm ? 2 : 1; // skip the dims and "hr"
      continue;
    }
    if (!current) continue;

    if (/^Total$/i.test(l)) {
      // "Prep: X" "+" "Painting: Y" "=" "Z" — read only what is actually there.
      let j = i + 1;
      let prep: number | null = null;
      let paint: number | null = null;
      let total: number | null = null;
      for (; j < Math.min(i + 7, lines.length); j++) {
        const s = lines[j];
        const pm = s.match(/^Prep:\s*([\d.]+)$/i);
        const gm = s.match(/^Painting:\s*([\d.]+)$/i);
        if (pm) { prep = num(pm[1]); continue; }
        if (gm) { paint = num(gm[1]); continue; }
        if (s === "+") continue;
        if (s === "=") { total = bareNumber.test(lines[j + 1] ?? "") ? num(lines[j + 1]) : null; break; }
        break;
      }
      if (prep != null || paint != null || total != null) {
        current.hours_prep = prep;
        current.hours_paint = paint;
        current.hours_total = total ?? round2((prep ?? 0) + (paint ?? 0));
      }
      continue;
    }

    const m = l.match(itemRe);
    if (m) {
      // A line is real when its own hours or coats follow before the next
      // line or the area's Total; free text in parentheses is not.
      let coats: number | null = null;
      let hours: number | null = null;
      let product = "";
      let litres: number | null = null;
      let j = i + 1;
      for (; j < Math.min(i + 12, lines.length); j++) {
        const s = lines[j];
        if (/^Total$/i.test(s) || itemRe.test(s) || isHeadingAt(j)) break;
        const cm = s.match(/^Coats:\s*(\d+)$/i);
        if (cm) { coats = num(cm[1]); continue; }
        const pm = s.match(productLineRe);
        if (pm) { product = pm[1].trim(); litres = num(pm[2]); continue; }
        if (bareNumber.test(s)) { hours = num(s); break; }
      }
      if (hours == null && coats == null) continue;
      const unit: ParsedWorkOrderItem["unit"] = m[3] ? (m[3] === "m" ? "m" : "m2") : "count";
      current.items.push({ item: m[1].trim(), qty: num(m[2]), unit, coats, hours, product, litres });
      i = hours == null ? i : j; // the hours line ends the item
      continue;
    }
  }

  const hoursFromLines = round2(areas.reduce((n, a) => {
    if (a.items.length > 0) return n + a.items.reduce((m, it) => m + (it.hours ?? 0), 0);
    return n + (a.hours_total ?? 0);
  }, 0));

  return { quoteNo, totalHours, hoursFromLines, materials, totalDimensions, areas, optionHeadings };
}
