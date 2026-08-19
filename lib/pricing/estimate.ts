/**
 * Estimate pricing — the single source of truth for every derived amount.
 *
 * Pure functions: plain typed objects in, integer cents out. No React, no
 * Supabase, no Date, no randomness. That is what lets the SERVER recompute a
 * total instead of trusting whatever the browser sent, which is the whole point
 * of the exercise.
 *
 * Extracted verbatim from QuoteBuilder's `surfaceCalc` / `lineCalc` / `totals`.
 * Behaviour is deliberately unchanged, quirks included — the golden fixtures in
 * `__fixtures__/golden-estimates.json` assert that every existing estimate still
 * prices to the exact cent. If you intend to change a number, change a test
 * first.
 *
 * Money convention: every `*Cents` value is an integer. Rounding happens at the
 * same points, in the same order, as it always did — moving a `Math.round` here
 * moves real invoices.
 */

import { hoursPerUnit } from "./engine.ts";
import type { Product, RateItem } from "./types.ts";

// ---------------------------------------------------------------------------
// Inputs — structural mirrors of the builder's state, with the UI fields left
// out. Anything that doesn't change a cent doesn't belong here.
// ---------------------------------------------------------------------------

/** A6: window sizes. Absent/null = medium — existing rows price unchanged. */
export type WindowSize = "small" | "medium" | "large";

export type SurfaceInput = {
  code: string;
  coats: number;
  count: number;
  prepHr: number;
  /** Only meaningful on window rates; a multiplier on the window rate
   * (Settings-tunable, defaults 0.8 / 1.0 / 1.2). */
  size?: WindowSize | null;
  /** Priced like any other surface — `hidden` only affects what the customer sees. */
  hidden?: boolean;
  measureL?: number | null;
  measureH?: number | null;
  qtyOverride?: number | null;
  rateOverride?: number | null;
  paintingHrOverride?: number | null;
  useCustomRate?: boolean;
  customRate?: number | null;
  coverageOverride?: number | null;
  volumeOverride?: number | null;
  unitPriceOverride?: number | null;
  priceOverride?: number | null;
  /** null = follow the global material choice; set = pinned to this product. */
  productName?: string | null;
};

export type AreaInput = {
  kind: "area";
  type: "Interior" | "Exterior";
  areaType: "room" | "surface";
  L: number;
  W: number;
  H: number;
  isOption?: boolean;
  surfaces: SurfaceInput[];
};

export type LineInput = {
  kind: "line";
  type: "Interior" | "Exterior";
  mode: "hourly" | "quantity" | "custom";
  hours: number;
  rate: number;
  qty: number;
  unitPrice: number;
  custom: number;
  cost: number;
  woHours: number;
  isOption?: boolean;
};

export type BlockInput = AreaInput | LineInput;

export type ModifierRef = { code: string; group_name: string; multiplier: number };
export type SettingRow = { key: string; value: unknown };

export type PricingContext = {
  rateItems: RateItem[];
  products: Product[];
  modifiers: ModifierRef[];
  settings: SettingRow[];
};

export type Adjustments = {
  /** Which modifier code is selected per group, e.g. { "Level of Finish": "FIN-3" }. */
  modSel: Record<string, string>;
  /** Global product choice per `${type}::${code}`. */
  materials: Record<string, string>;
  discountPct?: number;
  discountMode?: "pct" | "fixed";
  discountFixedCents?: number;
  hourlyRateOverride?: number | null;
  contractorRateOverride?: number | null;
};

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type SurfaceResult = {
  qty: number;
  rate: number;
  isItem: boolean;
  chargeCents: number;
  paintingHr: number;
  prepHr: number;
  labourCents: number;
  volume: number;
  unitPriceCents: number;
  matCostCents: number;
  matPriceCents: number;
  totalCents: number;
};

export type LineResult = { priceCents: number; hours: number; costCents: number };

export type EstimateTotals = {
  subtotalCents: number;
  sundriesCents: number;
  discountCents: number;
  netSubtotalCents: number;
  gstCents: number;
  totalCents: number;
  contractorHours: number;
  contractorOfferCents: number;
  materialsCostCents: number;
  marginCents: number;
};

// ---------------------------------------------------------------------------
// Settings + lookups
// ---------------------------------------------------------------------------

/** The builder's own normaliser — punctuation-tolerant setting keys. */
export const normKey = (k: string) => k.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();

function settingsLookup(settings: SettingRow[]) {
  const m = new Map<string, number>();
  for (const s of settings) {
    const raw = s.value as { value?: number } | number | null | undefined;
    const v = raw == null ? undefined : typeof raw === "number" ? raw : raw.value;
    if (v != null) m.set(normKey(s.key), v);
  }
  return (k: string) => m.get(normKey(k));
}

/** Every tunable the maths reads, with the same defaults the builder used. */
export function resolveRates(ctx: PricingContext, adj: Adjustments) {
  const sNum = settingsLookup(ctx.settings);
  return {
    markup: sNum("Materials markup") ?? 0.1,
    gstRate: sNum("GST") ?? 0.1,
    sundriesIntCents: Math.round((sNum("Sundries per job — interior") ?? 0) * 100),
    sundriesExtCents: Math.round((sNum("Sundries per job — exterior") ?? 0) * 100),
    contractorHourlyCents: Math.round((sNum("Contractor rate") ?? 60) * 100),
    offerPct: sNum("Contractor offer — % of estimated hours") ?? 1,
    hourlyRateOverride: adj.hourlyRateOverride ?? null,
    contractorRateOverride: adj.contractorRateOverride ?? null,
    // A6: window size multipliers — one window rate × size, not separate
    // small/large rate items (any legacy ones price as-is, flagged in
    // Settings as superseded).
    windowSmall: sNum("Window size — small") ?? 0.8,
    windowLarge: sNum("Window size — large") ?? 1.2,
  };
}

/** True for rate items the S/M/L control applies to. */
export function isWindowItem(item: RateItem | undefined): boolean {
  return /window/i.test(item?.sub_category ?? "");
}

/** A6: the size multiplier for a surface on a window rate. Medium/absent = 1. */
export function windowSizeMultiplier(
  item: RateItem | undefined,
  size: WindowSize | null | undefined,
  rates: Pick<ResolvedRates, "windowSmall" | "windowLarge">,
): number {
  if (!isWindowItem(item)) return 1;
  if (size === "small") return rates.windowSmall;
  if (size === "large") return rates.windowLarge;
  return 1;
}

export type ResolvedRates = ReturnType<typeof resolveRates>;

export function itemIndex(rateItems: RateItem[]) {
  const m = new Map<string, RateItem>();
  for (const r of rateItems) m.set(`${r.category}::${r.code}`, r);
  return m;
}

export function productIndex(products: Product[]) {
  const m = new Map<string, Product>();
  for (const p of products) m.set(p.name, p);
  return m;
}

/** Charge-out rate in cents for a category, honouring a per-estimate override. */
export function chargeOutCents(type: string, rateItems: RateItem[], hourlyRateOverride: number | null) {
  if (hourlyRateOverride != null) return Math.round(hourlyRateOverride * 100);
  return rateItems.find((r) => r.category === type)?.charge_out_cents ?? (type === "Interior" ? 8500 : 10000);
}

/** Combined labour multiplier from the selected modifiers. Materials are untouched. */
export function jobModifier(modifiers: ModifierRef[], modSel: Record<string, string>) {
  const mult = (group: string) =>
    modSel[group] ? modifiers.find((m) => m.code === modSel[group])?.multiplier : undefined;
  return (
    (mult("Condition") ?? 1) *
    (mult("Access") ?? 1) *
    (mult("Level of Finish") ?? 1) *
    (mult("Job Size") ?? 1) *
    (modSel["Staging"] ? (modifiers.find((m) => m.code === modSel["Staging"])?.multiplier ?? 1) : 1)
  );
}

const materialKey = (type: string, code: string) => `${type}::${code}`;

/** Pinned product → global choice → the rate card's default. */
export function productNameFor(
  type: string,
  s: SurfaceInput,
  materials: Record<string, string>,
  items: Map<string, RateItem>,
): string | null {
  return s.productName ?? materials[materialKey(type, s.code)] ?? items.get(materialKey(type, s.code))?.default_product ?? null;
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

/** Measured quantity for a surface: m², lineal m, or a count of items. */
export function computeQuantity(item: RateItem | undefined, area: AreaInput, s: SurfaceInput): number {
  if (!item) return 0;
  if (s.qtyOverride != null) return s.qtyOverride;
  if (item.unit === "Hours Per Item") return s.count;
  // Per-surface measurement beats the area's own dimensions.
  if (item.unit === "Lineal Metres") {
    if (s.measureL != null) return s.measureL;
  } else if (s.measureL != null && s.measureH != null) {
    return s.measureL * s.measureH;
  }
  const flat = /ceiling|floor|roof|soffit/i.test(item.sub_category ?? "");
  const { L, W, H } = area;
  if (area.areaType === "surface") {
    // one plane: length × height, or just length for lineal work
    if (item.unit === "Lineal Metres") return L || 0;
    return L && H ? L * H : 0;
  }
  // a room: walls = perimeter × height, flat surfaces = L × W, lineal = perimeter
  if (item.unit === "Lineal Metres") return L && W ? 2 * (L + W) : 0;
  if (flat) return L && W ? L * W : 0;
  return L && W && H ? 2 * (L + W) * H : 0;
}

// ---------------------------------------------------------------------------
// Surface and line pricing
// ---------------------------------------------------------------------------

export function priceSurface(
  area: AreaInput,
  s: SurfaceInput,
  ctx: PricingContext,
  adj: Adjustments,
  rates: ResolvedRates,
  items = itemIndex(ctx.rateItems),
  productsByName = productIndex(ctx.products),
  jobMod = jobModifier(ctx.modifiers, adj.modSel),
): SurfaceResult {
  const chargeBase =
    s.useCustomRate && s.customRate != null
      ? Math.round(s.customRate * 100)
      : chargeOutCents(area.type, ctx.rateItems, rates.hourlyRateOverride);

  const item = items.get(`${area.type}::${s.code}`);
  if (!item) {
    // No rate item: prep hours are still chargeable, nothing else is.
    const labour = Math.round(s.prepHr * chargeBase);
    return {
      qty: 0, rate: 0, isItem: false, chargeCents: chargeBase,
      paintingHr: 0, prepHr: s.prepHr, labourCents: labour,
      volume: 0, unitPriceCents: 0, matCostCents: 0, matPriceCents: 0, totalCents: labour,
    };
  }

  const qty = computeQuantity(item, area, s);
  const isItem = item.unit === "Hours Per Item";
  const baseHpu = hoursPerUnit(item, s.coats);
  const dispRate = s.rateOverride ?? (isItem ? baseHpu : 1 / baseHpu);
  const baseHours = isItem ? dispRate * qty : dispRate > 0 ? qty / dispRate : 0;
  const sizeMul = windowSizeMultiplier(item, s.size, rates);
  const paintingHr = s.paintingHrOverride ?? baseHours * jobMod * sizeMul;
  const labourCents = Math.round((paintingHr + s.prepHr) * chargeBase);

  const prodName = productNameFor(area.type, s, adj.materials, items);
  const product = prodName ? productsByName.get(prodName) : undefined;
  const wastage = (product?.wastage_pct ?? 0) / 100;
  const coverage = s.coverageOverride ?? product?.coverage ?? null;

  let volume = s.volumeOverride ?? null;
  if (volume == null) {
    if (isItem) {
      volume = item.litres_per_item_per_coat != null ? qty * s.coats * item.litres_per_item_per_coat * (1 + wastage) : 0;
    } else if (item.metres_per_litre != null) {
      volume = ((qty * s.coats) / item.metres_per_litre) * (1 + wastage);
    } else if (coverage) {
      volume = ((qty * s.coats) / coverage) * (1 + wastage);
    } else {
      volume = 0;
    }
  }

  const unitPriceCents = s.unitPriceOverride != null ? Math.round(s.unitPriceOverride * 100) : product?.price_per_litre ?? 0;
  const matCostCents = Math.round(volume * unitPriceCents);
  const matPriceCents = Math.round(matCostCents * (1 + rates.markup));

  // A manual price override sets the surface total; labour absorbs the
  // difference so contractor hours and materials cost stay honest for margin.
  const computedTotal = labourCents + matPriceCents;
  const totalCents = s.priceOverride != null ? Math.round(s.priceOverride * 100) : computedTotal;
  const finalLabour = s.priceOverride != null ? totalCents - matPriceCents : labourCents;

  return {
    qty, rate: dispRate, isItem, chargeCents: chargeBase,
    paintingHr, prepHr: s.prepHr, labourCents: finalLabour,
    volume, unitPriceCents, matCostCents, matPriceCents, totalCents,
  };
}

export function priceLine(l: LineInput): LineResult {
  if (l.mode === "hourly") {
    // Labour is paid through the contractor offer, so it carries no separate cost.
    return { priceCents: Math.round(l.hours * l.rate * 100), hours: l.hours, costCents: 0 };
  }
  if (l.mode === "quantity") {
    return { priceCents: Math.round(l.qty * l.unitPrice * 100), hours: l.woHours, costCents: Math.round(l.cost * 100) };
  }
  return { priceCents: Math.round(l.custom * 100), hours: l.woHours, costCents: Math.round(l.cost * 100) };
}

// ---------------------------------------------------------------------------
// Whole-estimate totals
// ---------------------------------------------------------------------------

export function priceEstimateTotals(
  blocks: BlockInput[],
  ctx: PricingContext,
  adj: Adjustments,
): EstimateTotals {
  const rates = resolveRates(ctx, adj);
  const items = itemIndex(ctx.rateItems);
  const productsByName = productIndex(ctx.products);
  const jobMod = jobModifier(ctx.modifiers, adj.modSel);

  let subtotal = 0;
  let contractorHours = 0;
  let materialsCost = 0;
  let anyInt = false;
  let anyExt = false;

  for (const b of blocks) {
    if (b.isOption) continue; // options sit outside the total until accepted
    if (b.type === "Interior") anyInt = true;
    else anyExt = true;

    if (b.kind === "area") {
      for (const s of b.surfaces) {
        const c = priceSurface(b, s, ctx, adj, rates, items, productsByName, jobMod);
        subtotal += c.totalCents;
        contractorHours += c.paintingHr + c.prepHr;
        materialsCost += c.matCostCents;
      }
    } else {
      const c = priceLine(b);
      subtotal += c.priceCents;
      contractorHours += c.hours;
      materialsCost += c.costCents;
    }
  }

  const sundriesCents = (anyInt ? rates.sundriesIntCents : 0) + (anyExt ? rates.sundriesExtCents : 0);
  subtotal += sundriesCents;

  // Discount comes off the ex-GST subtotal (and out of margin) — a percentage
  // or a flat amount, capped so it can never exceed the subtotal.
  const discountCents =
    adj.discountMode === "fixed"
      ? Math.min(adj.discountFixedCents || 0, subtotal)
      : Math.round((subtotal * (adj.discountPct || 0)) / 100);

  const netSubtotalCents = subtotal - discountCents;
  const gstCents = Math.round(netSubtotalCents * rates.gstRate);

  const effContractorHourlyCents =
    rates.contractorRateOverride != null ? Math.round(rates.contractorRateOverride * 100) : rates.contractorHourlyCents;
  const contractorOfferCents = Math.round(contractorHours * effContractorHourlyCents * rates.offerPct);
  const marginCents = netSubtotalCents - contractorOfferCents - materialsCost;

  return {
    subtotalCents: subtotal,
    sundriesCents,
    discountCents,
    netSubtotalCents,
    gstCents,
    totalCents: netSubtotalCents + gstCents,
    contractorHours,
    contractorOfferCents,
    materialsCostCents: materialsCost,
    marginCents,
  };
}

/** Total for one area — used by the per-area summary in the builder. */
export function priceArea(area: AreaInput, ctx: PricingContext, adj: Adjustments): number {
  const rates = resolveRates(ctx, adj);
  const items = itemIndex(ctx.rateItems);
  const productsByName = productIndex(ctx.products);
  const jobMod = jobModifier(ctx.modifiers, adj.modSel);
  return area.surfaces.reduce(
    (n, s) => n + priceSurface(area, s, ctx, adj, rates, items, productsByName, jobMod).totalCents,
    0,
  );
}

/** Deposit payable on acceptance, as a percentage of the GST-inclusive total. */
export function depositCents(totalCents: number, depositPct: number): number {
  return Math.round((totalCents * depositPct) / 100);
}
