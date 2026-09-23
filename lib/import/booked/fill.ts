/**
 * Part C · fill a handover job's scope from its PaintScout work order.
 *
 * A job the Zap door wrote has the quote's areas with their signed prices and
 * NO lines: every area is a priced line item and `external_ref.hours_pending`
 * is true (lib/import/booked/zap.ts). The work-order page has the lines —
 * quantity, coats, product, hours — and the per-area hours split. This joins
 * the two into the same `BookedJob` shape the pack loader builds from, so
 * `buildBookedJob` proves the signed total to the cent over the new scope
 * exactly as it did over the old one, and one build path exists.
 *
 * Pure. The rules, each visible in the check output:
 *   · A work-order area takes the price of the FIRST unconsumed quote area
 *     with the same name (case, spacing and punctuation ignored); PaintScout
 *     repeats a name when the estimator adds a second pass over a side, and
 *     the quote lists them in the same order.
 *   · A work-order area with hours and no priced twin is crew work priced
 *     inside another area ($0 here, its hours on the sheet) — reported.
 *   · A quote area the work order does not show keeps its price and stays a
 *     line with no hours (scaffolding, travel, a carpenter) — reported.
 *   · The discount, if any, rides along from the estimate's external_ref.
 *   · Line hours plus hours-only areas must equal the page's Total Hours
 *     banner when the page printed one; a difference is a refusal upstream,
 *     because the hours are the whole point.
 */

import type { BookedArea, BookedItem, BookedJob } from "./types";
import type { ParsedWorkOrder } from "./workorder-text";

/** What the script reads off the estimate + work order rows before merging. */
export type ExistingImportedJob = {
  quoteNo: string;
  title: string;
  levelOfFinish: number;
  subtotalCents: number;
  totalCents: number;
  /** ISO timestamp the customer signed (estimates.accepted_at). */
  acceptedAt: string;
  acceptedName: string;
  contractorPaymentCents: number | null;
  builderState: unknown;
  externalRef: Record<string, unknown>;
};

export type PricedBlock = { name: string; priceCents: number; kind: "area" | "line" | "heading" | "discount" };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOr = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const cents = (dollars: unknown): number => Math.round(numOr(dollars, 0) * 100);
export const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The priced blocks of an imported working scope, in order. An area's price
 * is the sum of its surfaces' overrides; a line's is its custom figure; a
 * hidden $0 line is a heading; a negative line is the discount.
 */
export function pricedBlocksOf(builderState: unknown): PricedBlock[] {
  const blocks = builderState && typeof builderState === "object" ? (builderState as { blocks?: unknown }).blocks : null;
  if (!Array.isArray(blocks)) return [];
  const out: PricedBlock[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const name = str(b.name);
    if (!name) continue;
    if (b.kind === "area") {
      const surfaces = Array.isArray(b.surfaces) ? (b.surfaces as Array<Record<string, unknown>>) : [];
      out.push({ name, priceCents: surfaces.reduce((n, s) => n + cents(s.priceOverride), 0), kind: "area" });
      continue;
    }
    const price = cents(b.custom);
    if (price < 0) out.push({ name, priceCents: price, kind: "discount" });
    else out.push({ name, priceCents: price, kind: b.hidden === true && price === 0 ? "heading" : "line" });
  }
  return out;
}

export type FillResult = {
  job: BookedJob;
  /** One line per work-order area: where its price came from. */
  mapping: string[];
  /** Things a person should read before writing: unmatched areas, hours that disagree with the banner. */
  warnings: string[];
  /** True when the page's Total Hours banner exists and differs from the lines. */
  hoursDisagree: boolean;
};

export function jobFromWorkOrder(existing: ExistingImportedJob, wo: ParsedWorkOrder, opts: { workOrderUrl?: string } = {}): FillResult {
  const ref = existing.externalRef;
  const state = existing.builderState && typeof existing.builderState === "object" ? (existing.builderState as Record<string, unknown>) : {};
  const contact = state.contact && typeof state.contact === "object" ? (state.contact as Record<string, unknown>) : {};
  const jobAddress = state.jobAddress && typeof state.jobAddress === "object" ? (state.jobAddress as Record<string, unknown>) : {};

  const priced = pricedBlocksOf(existing.builderState);
  const discount = priced.find((b) => b.kind === "discount");
  const pool = priced.filter((b) => b.kind !== "discount").map((b) => ({ ...b, used: false }));
  const mapping: string[] = [];
  const warnings: string[] = [];

  const areas: BookedArea[] = wo.areas.map((a) => {
    const twin = pool.find((p) => !p.used && normName(p.name) === normName(a.name));
    if (twin) twin.used = true;
    const items: BookedItem[] = a.items.map((it) => ({
      item: it.item, qty: it.qty, unit: it.unit, hours: it.hours, coats: it.coats, product: it.product || "",
    }));
    const hours = items.length > 0 ? items.reduce((n, it) => n + (it.hours ?? 0), 0) : a.hours_total ?? 0;
    const price = twin ? twin.priceCents : null;
    if (twin) mapping.push(`${a.name}: $${(twin.priceCents / 100).toFixed(2)} from the quote · ${items.length} line${items.length === 1 ? "" : "s"} · ${hours} h`);
    else if (hours > 0) {
      mapping.push(`${a.name}: no priced twin on the quote · ${items.length} line${items.length === 1 ? "" : "s"} · ${hours} h at $0`);
      warnings.push(`"${a.name}" carries ${hours} h on the work order but the quote has no area of that name — it goes in at $0 (its price sits inside another area).`);
    } else mapping.push(`${a.name}: heading only (no price, no hours)`);
    return {
      name: a.name, price_ex_gst_cents: price, hours_prep: a.hours_prep, hours_paint: a.hours_paint,
      hours_total: items.length > 0 ? Math.round(hours * 100) / 100 : a.hours_total,
      length_m: a.length_m, width_m: a.width_m, height_m: a.height_m, items,
    };
  });
  for (const p of pool) {
    if (p.used) continue;
    // Heading-only quote rows ($0, hidden) that the work order also lacks add
    // nothing; a priced one keeps its money.
    if (p.kind === "heading") continue;
    areas.push({ name: p.name, price_ex_gst_cents: p.priceCents, hours_prep: null, hours_paint: null, hours_total: null, length_m: null, width_m: null, height_m: null, items: [] });
    mapping.push(`${p.name}: $${(p.priceCents / 100).toFixed(2)} on the quote, not on the work order · kept as a line with no hours`);
    warnings.push(`"${p.name}" is priced on the quote but the work order has no area of that name — kept as a priced line with no hours.`);
  }

  const totalHours = Math.round(areas.reduce((n, a) => n + (a.items.length > 0 ? a.items.reduce((m, it) => m + (it.hours ?? 0), 0) : a.hours_total ?? 0), 0) * 100) / 100;
  const hoursDisagree = wo.totalHours != null && Math.abs(wo.totalHours - totalHours) > 0.011;
  if (hoursDisagree) warnings.push(`the page says ${wo.totalHours} h in total; its lines add up to ${totalHours} h.`);
  if (wo.totalHours == null) warnings.push("the page printed no Total Hours banner; the lines' own hours are used unproven.");

  const discountCents = discount ? discount.priceCents : numOr(ref.discount_ex_gst_cents, 0);
  const job: BookedJob = {
    quote_no: existing.quoteNo,
    view: ref.view === "needs" ? "needs" : "booked",
    airtable_status: str(ref.airtable_status),
    project_name: existing.title || `Quote ${existing.quoteNo}`,
    customer_name: existing.acceptedName || [str(contact.first_name), str(contact.last_name)].filter(Boolean).join(" "),
    email: str(contact.email).toLowerCase(),
    phone: str(contact.phone),
    account_key: "",
    address: str(jobAddress.address) || str(contact.address),
    suburb: str(jobAddress.city) || str(contact.city),
    postcode: str(jobAddress.postal) || str(contact.postal),
    paintscout_address: "",
    job_type: str(ref.job_type),
    job_type_norm: jobSideOf(existing.builderState),
    level_of_finish: existing.levelOfFinish === 2 || existing.levelOfFinish === 4 ? existing.levelOfFinish : 3,
    level_of_finish_assumed: ref.level_of_finish_assumed === true ? "yes" : "",
    quote_url: str(ref.quote_url),
    work_order_url: opts.workOrderUrl || str(ref.work_order_url),
    subtotal_ex_gst_cents: existing.subtotalCents,
    gst_cents: existing.totalCents - existing.subtotalCents,
    total_inc_gst_cents: existing.totalCents,
    discount_ex_gst_cents: discountCents < 0 ? discountCents : 0,
    discount_label: discount?.name || str(ref.discount_label),
    options_accepted_ex_gst_cents: numOr(ref.options_accepted_ex_gst_cents, 0),
    total_hours: totalHours,
    airtable_estimated_hours: typeof ref.airtable_estimated_hours === "number" ? ref.airtable_estimated_hours : null,
    estimated_materials_cents: typeof ref.estimated_materials_cents === "number" ? ref.estimated_materials_cents : null,
    contractor_offer_cents: existing.contractorPaymentCents,
    start_date: str(ref.airtable_start_date),
    end_date: str(ref.airtable_end_date),
    number_of_workers: numOr(ref.airtable_workers, 0),
    assigned_painter: str(ref.airtable_painter),
    assigned_painter_email: str(ref.airtable_painter_email),
    painter_accepted: str(ref.airtable_painter_accepted),
    date_accepted_ms: Date.parse(existing.acceptedAt),
    deposit_recorded: ref.deposit_recorded === true ? "yes" : "no",
    notes: str(ref.airtable_notes),
    import_note: str(ref.import_note),
    areas,
    materials: wo.materials,
  };
  return { job, mapping, warnings, hoursDisagree };
}

/** The side the Zap decided at import: every block carries it as `type`. */
function jobSideOf(builderState: unknown): "interior" | "exterior" {
  const blocks = builderState && typeof builderState === "object" ? (builderState as { blocks?: unknown }).blocks : null;
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      const t = b && typeof b === "object" ? (b as { type?: unknown }).type : null;
      if (t === "Exterior") return "exterior";
      if (t === "Interior") return "interior";
    }
  }
  return "interior";
}
