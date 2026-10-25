/**
 * Paint Home brief §6 — the staff side: ONE brand filter and ONE pill
 * vocabulary for every list (estimates, wizard sessions, CRM Today, PC
 * Command, Invoicing). No separate views: a list reads `?brand=` through
 * `parseBrandFilter`, keeps the rows `matchesBrand` admits, and shows
 * `brandPillLabel` on a row. Pure, client-safe, tested.
 */
export const BRAND_FILTERS = ["all", "paintgroup", "painthome"] as const;
export type BrandFilter = (typeof BRAND_FILTERS)[number];

export const BRAND_FILTER_LABEL: Record<BrandFilter, string> = { all: "All", paintgroup: "Paint Group", painthome: "Paint Home" };

/** `?brand=` → a filter; anything else is "all". */
export function parseBrandFilter(v: unknown): BrandFilter {
  return v === "paintgroup" || v === "painthome" ? v : "all";
}

/** A row's `brand` column (null = Paint Group, the default every row has) against the filter. */
export function matchesBrand(rowBrand: unknown, filter: BrandFilter): boolean {
  if (filter === "all") return true;
  return (rowBrand === "painthome" ? "painthome" : "paintgroup") === filter;
}

/** The pill on a row: Paint Home rows are tagged; Paint Group rows carry nothing (it is the default and every list would wear it). */
export function brandPillLabel(rowBrand: unknown, always = false): string | null {
  // Tom, 25 Oct 2026: on the Estimates list EVERY enquiry says which shopfront it came through (`always`);
  // elsewhere the default brand still wears nothing.
  return rowBrand === "painthome" ? "Paint Home" : always ? "Paint Group" : null;
}
