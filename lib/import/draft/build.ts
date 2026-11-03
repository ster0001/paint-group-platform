import { adjustmentsFrom } from "@/lib/pricing/context";
import { chargeOutCents, isWindowItem, itemIndex, priceEstimateTotals, type BlockInput, type EstimateTotals, type PricingContext, type WindowSize } from "@/lib/pricing/estimate";
import type { ParsedWorkOrder, ParsedWorkOrderItem } from "@/lib/import/booked/workorder-text";
import type { QuoteFacts } from "./quote-text";

/**
 * A PaintScout job as an EDITABLE DRAFT priced by the platform (Tom, 4 Nov
 * 2026: "add this property into estimates from Paint Scout … the pricing
 * updated based on the new system pricing, and it is editable").
 *
 * The opposite of lib/import/booked/build.ts, which carries PaintScout's
 * SIGNED prices as overrides. Here nothing is overridden: every work-order
 * line becomes a surface on a real rate code with its quantity and coats, the
 * engine (lib/pricing) prices it from the active rate card, and the builder
 * re-prices it on every save. PaintScout's hours and dollars are read only to
 * REPORT how far the platform's figure lands from PaintScout's.
 *
 *   · a line whose item name maps (docs/imports/substrate-name-map.json) →
 *     that rate code: lineal metres and m² as a quantity, items as a count;
 *     a window named "communal" or "large" is a large window;
 *   · a line with no mapping, and an area with hours and no lines
 *     (Scaffolding, Interior Preparation, Cleaning) → an HOURLY line: the
 *     work order's hours at the platform's charge-out rate for that side;
 *   · the work order's paint per rate code → the Materials card's global
 *     choice (`materials`), when the catalogue has that product.
 *
 * Pure: the caller supplies the pricing context and the name map.
 */

export type NameMapRow = { paintscout_item: string; side: "interior" | "exterior"; platform_rate_code: string };
type Side = "Interior" | "Exterior";

type DraftSurface = {
  id: number; code: string; internalLabel: string; clientLabel: string; coats: number; count: number;
  size: WindowSize | null; hidden: false; isOption: false; media: never[];
  measureL: null; measureH: null; qtyOverride: number | null; rateOverride: null;
  paintingHrOverride: null; prepHr: number; priceOverride: null; productName: null; color: ""; colorHex: "";
  coverageOverride: null; volumeOverride: null; unitPriceOverride: null; crewNote: string;
  hideQty: false; showCoats: true; showPrice: false; useCustomRate: false; customRate: null; open: false;
};
type DraftArea = {
  id: number; kind: "area"; name: string; type: Side; areaType: "room" | "surface";
  L: number; W: number; H: number; isOption: false; description: string; open: false; media: never[]; surfaces: DraftSurface[];
};
type DraftLine = {
  id: number; kind: "line"; name: string; type: Side; mode: "hourly"; hours: number; rate: number; qty: 1; unitPrice: 0;
  custom: 0; cost: 0; woHours: 0; description: string; clientNote: ""; crewNote: ""; hidden: false; isOption: false;
  subcontractorExpense: false; media: never[]; open: false; detailsOpen: false; materials: never[];
};
export type DraftBlock = DraftArea | DraftLine;

export type DraftEstimate = {
  title: string;
  builderState: Record<string, unknown> & { blocks: DraftBlock[] };
  totals: EstimateTotals;
  /** PaintScout's work-order hours, for the comparison. */
  paintscoutHours: number;
  /** One line per decision a person should read before writing. */
  report: string[];
};

const EXTERIOR_AREA = /\b(exterior|front side|back|left side|right side|front|rear|side|facade|fence|deck|eaves|gutters?)\b/i;

/** Interior or exterior: from the work order's own headings. */
export function jobSideOf(wo: ParsedWorkOrder): Side {
  const names = wo.areas.map((a) => a.name);
  if (names.some((n) => /^exterior\b/i.test(n))) return "Exterior";
  if (names.some((n) => /^interior\b/i.test(n))) return "Interior";
  return names.filter((n) => EXTERIOR_AREA.test(n)).length > names.length / 2 ? "Exterior" : "Interior";
}

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

export function buildDraftFromWorkOrder(
  wo: ParsedWorkOrder,
  quote: QuoteFacts,
  ctx: PricingContext,
  nameMap: NameMapRow[],
  opts: { levelOfFinish?: number; quoteUrl?: string; workOrderUrl?: string } = {},
): DraftEstimate {
  const side = jobSideOf(wo);
  const sideKey = side === "Exterior" ? "exterior" : "interior";
  const items = itemIndex(ctx.rateItems);
  const hasCode = (code: string) => items.has(`${side}::${code}`) || ctx.rateItems.some((r) => r.code === code);
  const byName = new Map(nameMap.filter((r) => r.side === sideKey).map((r) => [r.paintscout_item.trim().toLowerCase(), r.platform_rate_code]));
  const products = new Set(ctx.products.map((p) => p.name));
  const rateDollars = chargeOutCents(side, ctx.rateItems, null) / 100;

  let nextId = 1;
  const blocks: DraftBlock[] = [];
  const report: string[] = [];
  /** `${side}::${code}` → product → count of lines that asked for it. */
  const productVotes = new Map<string, Map<string, number>>();

  const hourlyLine = (name: string, hours: number, why: string): DraftLine => {
    report.push(`${name}: ${why} — an hourly line, ${hours} h at the platform's $${rateDollars.toFixed(2)}/h`);
    return {
      id: nextId++, kind: "line", name, type: side, mode: "hourly", hours, rate: rateDollars, qty: 1, unitPrice: 0,
      custom: 0, cost: 0, woHours: 0, description: "", clientNote: "", crewNote: "", hidden: false, isOption: false,
      subcontractorExpense: false, media: [], open: false, detailsOpen: false, materials: [],
    };
  };

  const surfaceFor = (it: ParsedWorkOrderItem, areaName: string): DraftSurface | null => {
    const code = byName.get(it.item.trim().toLowerCase())
      ?? (/\bwindows?\b/i.test(it.item) ? byName.get("windows") : undefined);
    if (!code || !hasCode(code)) return null;
    const item = items.get(`${side}::${code}`) ?? ctx.rateItems.find((r) => r.code === code);
    const qty = typeof it.qty === "number" && it.qty > 0 ? it.qty : 0;
    const isCount = it.unit === "count";
    const size: WindowSize | null = isWindowItem(item) && /\b(communal|large|big|picture|bay)\b/i.test(it.item) ? "large" : null;
    if (size) report.push(`${areaName} · ${it.item}: priced as LARGE ${code}`);
    if (it.product) {
      const key = `${side}::${code}`;
      const votes = productVotes.get(key) ?? new Map<string, number>();
      votes.set(it.product, (votes.get(it.product) ?? 0) + 1);
      productVotes.set(key, votes);
    }
    return {
      id: nextId++, code, internalLabel: it.item, clientLabel: it.item,
      coats: typeof it.coats === "number" && it.coats > 0 ? Math.round(it.coats) : 2,
      count: isCount ? Math.max(1, qty) : 1, size, hidden: false, isOption: false, media: [],
      measureL: null, measureH: null, qtyOverride: isCount ? null : (qty > 0 ? qty : null), rateOverride: null,
      paintingHrOverride: null, prepHr: 0, priceOverride: null, productName: null, color: "", colorHex: "",
      coverageOverride: null, volumeOverride: null, unitPriceOverride: null,
      crewNote: it.unit === "m2" ? `${qty} m²` : it.unit === "m" ? `${qty} m` : "",
      hideQty: false, showCoats: true, showPrice: false, useCustomRate: false, customRate: null, open: false,
    };
  };

  for (const a of wo.areas) {
    if (a.items.length === 0) {
      const h = a.hours_total ?? 0;
      if (h > 0) blocks.push(hourlyLine(a.name, h, "hours with no lines"));
      else report.push(`${a.name}: a heading with no lines or hours — left out (the builder adds its own Preparation)`);
      continue;
    }
    const surfaces: DraftSurface[] = [];
    for (const it of a.items) {
      const s = surfaceFor(it, a.name);
      if (s) surfaces.push(s);
      else blocks.push(hourlyLine(`${a.name} · ${it.item}`, it.hours ?? 0, "no rate code for this item"));
    }
    if (surfaces.length === 0) continue;
    // An exterior side prints (length × height); a room (length × width × height).
    const L = a.length_m ?? 0;
    const W = side === "Exterior" ? 0 : (a.width_m ?? 0);
    const H = side === "Exterior" ? (a.height_m ?? a.width_m ?? 0) : (a.height_m ?? 2.4);
    blocks.push({
      id: nextId++, kind: "area", name: a.name, type: side, areaType: side === "Exterior" ? "surface" : "room",
      L, W, H, isOption: false, description: "", open: false, media: [], surfaces,
    });
  }

  const materials: Record<string, string> = {};
  for (const [key, votes] of productVotes) {
    const best = [...votes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    if (best && products.has(best)) materials[key] = best;
    else if (best) report.push(`${key.split("::")[1]}: PaintScout's "${best}" is not in the catalogue — the rate card's default product is used`);
  }

  const finish = opts.levelOfFinish ?? 3;
  const ja = quote.jobAddress;
  const [first, ...rest] = (quote.names[0] ?? "").split(/\s+/);
  const second = quote.names[1] ?? "";
  const contact = {
    first_name: first ?? "", last_name: rest.join(" "), company: quote.company,
    email: quote.emails[0] ?? "", phone: quote.phones[0] ?? "",
    address: ja?.street ?? "", city: ja?.suburb ?? "", state: ja?.state ?? "VIC", postal: ja?.postcode ?? "",
    ...(second ? { secondary_name: second, secondary_email: quote.emails[1] ?? "", secondary_phone: quote.phones[1] ?? "" } : {}),
  };
  const jobAddress = { address: ja?.street ?? "", city: ja?.suburb ?? "", state: ja?.state ?? "VIC", postal: ja?.postcode ?? "" };
  const builderState: DraftEstimate["builderState"] = {
    blocks,
    modSel: { "Level of Finish": `FIN-${finish}` },
    contact, jobAddress,
    materials, materialColours: {}, sheens: {}, colourMatches: {},
    exclusions: quote.exclusions,
    adminNotes: `Imported from PaintScout quote ${quote.quoteNo ?? wo.quoteNo ?? "?"} and priced by this system's rate card.${quote.totalCents != null ? ` PaintScout's total was $${(quote.totalCents / 100).toFixed(2)} inc GST.` : ""}${opts.quoteUrl ? ` Quote: ${opts.quoteUrl}` : ""}${opts.workOrderUrl ? ` · Work order: ${opts.workOrderUrl}` : ""}`,
  };
  const totals = priceEstimateTotals(blocks as unknown as BlockInput[], ctx, adjustmentsFrom(builderState));
  const title = ja ? [ja.street, titleCase(ja.suburb.toLowerCase())].join(", ") : (quote.names[0] ?? `PaintScout ${wo.quoteNo ?? ""}`);
  return { title, builderState, totals, paintscoutHours: wo.hoursFromLines, report };
}
