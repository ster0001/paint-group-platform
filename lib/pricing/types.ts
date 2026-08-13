// Pricing engine — data shapes.
// Field names match the database columns so rows from Supabase can be fed in directly.
// All money is integer cents.

export interface RateItem {
  code: string;
  category: "Interior" | "Exterior" | string;
  sub_category?: string | null;
  unit: string; // "M2" | "M2 Per Hour" | "Lineal Metres" | "Hours Per Item"
  rate_1_coat: number | null;
  rate_2_coat: number | null;
  rate_3_coat: number | null;
  default_coats?: number | null;
  charge_out_cents: number; // e.g. 8500 = $85/hr
  default_product?: string | null;
  metres_per_litre?: number | null; // for "Lineal Metres" items
  litres_per_item_per_coat?: number | null; // for "Hours Per Item" items
}

export interface Product {
  name: string;
  type?: string | null;
  coverage: number | null; // m² per litre (for area items)
  price_per_litre: number; // cents
  wastage_pct: number | null; // e.g. 10 means 10%
}

/** One production (painting) line: what to paint, how much, how many coats. */
export interface ProductionLineInput {
  item: RateItem;
  quantity: number; // m², lineal metres, or item count — matching item.unit
  coats: number; // effective LABOUR coats (colour-rule coats + 1 if an undercoat applies)
  product?: Product | null; // used for materials; omit to leave the line uncosted for paint
}

/** An hours-based line entered directly (prep or cleaning). */
export interface LabourLine {
  hours: number;
  chargeOutCents: number; // interior or exterior charge-out
  label?: string;
}

/** A pass-through: billed to the customer AND carrying a real cost (plan non-negotiable #5). */
export interface Passthrough {
  label?: string;
  priceCents: number;
  costCents: number;
}

export interface QuoteInput {
  production: ProductionLineInput[];

  // --- Compounding LABOUR modifiers, in the build-plan order (steps 2–5). ---
  // Applied to production HOURS only, before any conversion to money.
  conditionMultiplier?: number; // step 2 (default 1)
  accessMultiplier?: number; // step 3 (default 1)
  finishMultiplier: number; // step 4 — MANDATORY, no default (non-negotiable #4)
  sizeMultiplier?: number; // step 5 (default 1)
  stagingMultipliers?: number[]; // staging can stack; also labour

  prep?: LabourLine[]; // step 8
  cleaning?: LabourLine[]; // step 9
  materialsMarkup?: number; // step 10 — fraction, e.g. 0.1 = 10%
  sundriesCents?: number; // step 11 — per job (interior or exterior)
  passthroughs?: Passthrough[]; // step 12

  ownStaffCents?: number; // step 15 — cost of any own-staff labour
  contractorHourlyCents?: number; // step 14 — default 6000 ($60/hr)
  contractorOfferPct?: number; // step 14 — default 1 (100%)
}

export interface ProductionLineResult {
  code: string;
  category: string;
  baseHours: number; // step 1 — before modifiers
  modifiedHours: number; // step 6 — after the compounding modifiers
  labourCents: number; // step 7
  materialLitres: number;
  materialCostCents: number;
}

export interface QuoteResult {
  lines: ProductionLineResult[];
  labourModifier: number; // the combined multiplier applied to production hours

  productionHours: number; // Σ modified production hours
  productionLabourCents: number; // step 7
  prepLabourCents: number; // step 8
  cleaningLabourCents: number; // step 9
  materialCostCents: number; // step 10 — raw cost
  materialPriceCents: number; // step 10 — with markup (what the customer pays)
  sundriesCents: number; // step 11
  passthroughPriceCents: number; // step 12 — billed
  passthroughCostCents: number; // step 12 — real cost, recorded

  totalCents: number; // step 13 — the quote total
  contractorOfferCents: number; // step 14
  marginCents: number; // step 15 — total − contractor − own staff − materials cost − pass-through cost
}
