// The work-order document — the contractor-safe job sheet. Frozen into
// work_orders.wo_snapshot when staff issue the order, and served to the public
// /w/[token] route. NEVER contains customer pricing, margin, surname or email.

export type WOColourStatus = "tbc" | "confirmed";
export type WOSurfaceStatus = "not_started" | "in_progress" | "complete";

export type WOMaterial = {
  product: string;
  /** Stable row identity: `${product}||${colourName}`, bare product while the
   * colour is TBC. Keys work_orders.colours entries; absent on documents
   * frozen before the product×colour split (read those by bare product). */
  colourKey?: string;
  photoUrl: string;
  litres: number | null; // purchasable litres; null when coverage unknown
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
  coats: number;
  product: string;
  /** Per-surface colour truth (ruling 1, 30 Aug): the resolved estimate
   * colour rides EVERY surface so area×surface-type grouping downstream never
   * re-derives it through the product. Absent on pre-split documents. */
  colourName?: string;
  colourHex?: string;
  colourKey?: string;
  prep: string; // plain-English prep note
  hours: number | null; // hours allowance
  status: WOSurfaceStatus; // read-only in v1
};

export type WOArea = {
  id: string;
  title: string;
  surfaces: WOSurface[];
  photos: string[];
  /** Resolved PG level for this area — the job's level unless staff overrode it. */
  finishCode: string | null;
  /** True when this area differs from the job level, so the UI can call it out. */
  finishOverridden: boolean;
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
};

// Purchasable tin sizes (litres). Round total required litres UP to what the
// painter can actually buy at the trade counter.
const TIN_SIZES = [1, 2, 4, 10, 15, 20];
export function roundUpLitres(litres: number): number {
  if (!(litres > 0)) return 0;
  for (const s of TIN_SIZES) if (litres <= s) return s;
  return Math.ceil(litres / 20) * 20; // larger jobs: whole 20 L drums
}

export const WO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", issued: "Issued", in_progress: "In progress", complete: "Complete",
};
