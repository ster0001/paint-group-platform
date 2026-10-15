// The work-order document — the contractor-safe job sheet. Frozen into
// work_orders.wo_snapshot when staff issue the order, and served to the public
// /w/[token] route. NEVER contains customer pricing, margin, surname or email.

export type WOColourStatus = "tbc" | "confirmed";
export type WOSurfaceStatus = "not_started" | "in_progress" | "complete";

export type WOMaterial = {
  product: string;
  /** Sheen / finish for this row (Tom, 5 Sep 2026: set per surface type in the
   * builder, not per product). Absent on documents frozen before then. */
  finish?: string;
  /** Stable row identity: `${product}||${colourName}`, bare product while the
   * colour is TBC. Keys work_orders.colours entries; absent on documents
   * frozen before the product×colour split (read those by bare product). */
  colourKey?: string;
  photoUrl: string;
  litres: number | null; // order litres (orderLitres, rounded DOWN since 13 Oct 2026); null when coverage unknown
  /** The estimate's own litres for this row, wastage included, unrounded
   * (Tom, 13 Oct 2026: "a more accurate figure in litres"). Absent on
   * documents frozen before then. */
  estimatedLitres?: number;
  coverageMissing: boolean; // true → show staff warning, never a fabricated figure
  colourName: string;
  colourHex: string; // "" when none — for the swatch
  colourStatus: WOColourStatus;
  /**
   * Colour match (Tom, 23 Aug): the estimator flags a substrate for a colour
   * match and, when known, gives the code / brand / can size. Blank code = the
   * painter supplies it from the job (work_orders.colours → product → match);
   * the hand-over is gated until every required code is in. Optional — older
   * documents have none.
   */
  colourMatch?: { required: boolean; code: string; brand: string; canSize: string } | null;
};

export type WOSurface = {
  key: string; // stable key: `${areaId}:${surfaceId}`
  label: string;
  /**
   * The rate-card code this line was priced as (rate_items.code), so the
   * finish standard for the surface can be found whatever the estimator typed
   * as the client label (standards Step 1). Absent on documents frozen before
   * 8 Oct 2026 — those resolve by label (lib/standards/model.ts).
   */
  code?: string;
  /**
   * How many of the thing there are (doors, windows, posts — anything the
   * rate card prices per item). The same count the customer's estimate shows
   * (Tom, 18 Sep); on the painter's sheet it is shown from ONE up, because
   * "Doors" with no number is the ambiguity Tom asked to remove (14 Oct
   * 2026). Absent for measured surfaces (walls, ceilings) and on documents
   * frozen before 14 Oct 2026.
   */
  count?: number;
  /**
   * The measured quantity the surface was priced on and its unit — "38.4 m²"
   * of walls, "14 lm" of skirting — so the painter can see the size of the
   * work, not just its name (Tom, 15 Oct 2026: "there are also no
   * measurements on the work orders"). The builder's own quantity (the
   * estimate's `computeQuantity`: per-surface measurement, else the area's
   * dimensions, share applied), one decimal. Absent on per-item surfaces (they
   * carry `count`), on surfaces with no rate item, and on documents frozen
   * before 15 Oct 2026.
   */
  qty?: number;
  unit?: "m²" | "lm";
  coats: number;
  product: string;
  /** Sheen / finish this surface is painted in (absent on older documents). */
  finish?: string;
  /** Per-surface colour truth (ruling 1, 30 Aug): the resolved estimate
   * colour rides EVERY surface so area×surface-type grouping downstream never
   * re-derives it through the product. Absent on pre-split documents. */
  colourName?: string;
  colourHex?: string;
  colourKey?: string;
  /** The estimate's litres for this surface (wastage included, unrounded) —
   * feeds the per-area materials breakdown (Tom, 13 Oct 2026). Absent on
   * older documents and on surfaces with no product. */
  litres?: number;
  prep: string; // plain-English prep note
  hours: number | null; // hours allowance
  /**
   * How the hours allowance is made up (Tom, 3 Sep — "more hours need to be
   * added for the contractor" for a poor-condition job). `hours` already
   * carried the Condition multiplier; these say so out loud. paintingHours
   * is the modified painting time, prepHours the estimator's typed prep, and
   * conditionHours the slice of paintingHours the Condition modifier added.
   * Absent on documents frozen before 3 Sep 2026.
   */
  paintingHours?: number;
  prepHours?: number;
  conditionHours?: number;
  status: WOSurfaceStatus; // read-only in v1
};

export type WOArea = {
  id: string;
  title: string;
  /** Interior or exterior, from the builder's area type — tells the interior
   * and exterior standards apart where a rate code exists on both sides.
   * Absent on documents frozen before 8 Oct 2026. */
  side?: "interior" | "exterior";
  /**
   * The area's dimensions in metres as the estimator measured them — a room's
   * L × W × H, or a single plane's L × H with `w` 0 — frozen for the painter's
   * sheet (Tom, 15 Oct 2026). Absent when nothing was measured and on
   * documents frozen before 15 Oct 2026 unless migration 20270272 filled it.
   */
  dims?: { l: number; w: number; h: number };
  surfaces: WOSurface[];
  photos: string[];
  /** Resolved PG level for this area — the job's level unless staff overrode it. */
  finishCode: string | null;
  /** True when this area differs from the job level, so the UI can call it out. */
  finishOverridden: boolean;
};

/**
 * Tom, 16 Sep 2026: one option the customer can tick, as the crew would see
 * it. Saved beside the job sheet as `builder_state.woOptions[optionId]` and
 * merged into the work order by `wo_apply_selected_options` (migration
 * 20270149) once ticked — at acceptance, or by staff afterwards.
 */
export type WOOptionFragment = {
  id: string;
  title: string;
  areas: WOArea[];
  materials: WOMaterial[];
  contractorPaymentCents: number;
  conditionHours: number;
};

export type WorkOrderDoc = {
  version: 1;
  woRef: string;
  status: string; // draft | issued | in_progress | complete
  jobTitle: string;
  jobAddress: string;
  contactFirstName: string; // first name only — never surname/email
  contactPhone: string;
  startDate: string | null;
  accessNotes: string;
  crewNotes: string; // work-order-level further instructions for the crew
  levelOfFinish: string; // internal rate-card label, e.g. "Level 3 — Good. Full prep, filled…"
  /**
   * The contractor-facing PG standard for the job — "PG-3" etc, or null when the
   * estimate's level has no PG equivalent (see lib/workorder/finish.ts). Areas
   * may override it individually.
   */
  finishCode: string | null;
  /**
   * The priced Condition (Poor / Heritage / Weathered…) and what it added to
   * the painter's hours across the job. Null when no condition modifier is
   * selected; absent on pre-3-Sep documents. `extraHours` is 0 for Fair.
   */
  condition?: { code: string; label: string; multiplier: number; extraHours: number } | null;
  contractorName: string;
  contractorPaymentCents: number;
  materials: WOMaterial[];
  areas: WOArea[];
  exclusions: string[];
  /** "What's included" bullets (Tom, 25 Aug) — optional: snapshots issued
   *  before then don't carry it and render exclusions-only as before. */
  inclusions?: string[];
  company: { name: string; phone: string; logoUrl: string };
  /**
   * The estimator's ideal crew size (Job settings). The scheduler divides the
   * estimated hours by it to land the job with the right length. Optional —
   * documents issued before 23 Aug have none and read as one painter.
   */
  idealPainters?: number | null;
  /** Option ids already merged into this document (see WOOptionFragment). */
  appliedOptions?: string[];
};

/**
 * What the painter orders (Tom, 13 Oct 2026: "Materials should be marked
 * conservatively and rounded down rather than up … can sizes 1, 2, 4, 10 or
 * 15"). The estimate's litres already carry the product's wastage, so the
 * order is those litres rounded DOWN to whole litres — never up to the next
 * tin, which is how 4.1 L became a 10 L can and 15.5 L a 20 L drum and the
 * job sheet stopped adding up to the estimate. A row that needs any paint at
 * all orders at least one 1 L can.
 */
export const CAN_SIZES = [15, 10, 4, 2, 1] as const;

export function orderLitres(litres: number): number {
  if (!(litres > 0)) return 0;
  return Math.max(1, Math.floor(litres + 1e-9));
}

/**
 * The fewest cans that add up to exactly `litres` (whole litres — pass an
 * orderLitres figure), largest first: 13 L → 10 + 2 + 1, 20 L → 10 + 10 (not
 * 15 + 4 + 1). A non-whole figure (a litre count the office typed) is rounded
 * down first, the same conservative rule.
 */
export function cansFor(litres: number): { size: number; count: number }[] {
  const n = litres > 0 ? Math.floor(litres + 1e-9) : 0;
  if (n === 0) return [];
  // fewest[i] = fewest cans summing to i; pick[i] = the largest can that gets there
  const fewest = new Array<number>(n + 1).fill(Infinity);
  const pick = new Array<number>(n + 1).fill(0);
  fewest[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (const c of CAN_SIZES) {
      if (c <= i && fewest[i - c] + 1 < fewest[i]) { fewest[i] = fewest[i - c] + 1; pick[i] = c; }
    }
  }
  const counts = new Map<number, number>();
  for (let i = n; i > 0; i -= pick[i]) counts.set(pick[i], (counts.get(pick[i]) ?? 0) + 1);
  return CAN_SIZES.filter((c) => counts.has(c)).map((c) => ({ size: c, count: counts.get(c)! }));
}

/** "2 × 10 L + 1 L" — the can line under an order figure. */
export function cansLabel(litres: number): string {
  return cansFor(litres).map((c) => (c.count > 1 ? `${c.count} × ${c.size} L` : `${c.size} L`)).join(" + ");
}

/** Estimate litres for the eye: one decimal, "0.4 L" not "0.37500001 L". */
export function litresLabel(litres: number): string {
  return `${(Math.round(litres * 10) / 10).toLocaleString("en-AU", { maximumFractionDigits: 1 })} L`;
}

export const WO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", issued: "Issued", in_progress: "In progress", complete: "Complete",
};
