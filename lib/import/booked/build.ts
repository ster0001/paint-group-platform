/**
 * Part B · one signed PaintScout job → the builder's own working scope, the
 * customer document and the job sheet (brief B1.3–B1.4, Tom's B0.1 and B0.4).
 *
 * Pure. Given the job, its line → rate-code map, the pricing context and the
 * company letterhead it returns everything the database row needs, and it
 * REFUSES — throws — unless the engine's own total over the state it built
 * equals the PaintScout total to the cent. Nothing here prices a job: every
 * surface and every line is an override, and the engine is run only to prove
 * the overrides add up.
 *
 * Shapes are the builder's (app/quote/QuoteBuilder.tsx `Area` / `Surface` /
 * `LineBlock`) so Revision → Working scope opens the scope as if the office
 * had built it, and diffs edits against it block by block.
 *
 * Three deliberate readings of the pack, each checked against all 35 jobs
 * before this was written (16 Sep 2026):
 *   · PaintScout's per-line hours ALREADY include preparation — line hours
 *     plus the no-line areas sum to the job total exactly, and an area's
 *     `hours_prep` is a breakdown of that figure, not an addition. So
 *     `prepHr` stays 0 and the split is written into the area description.
 *   · An area with no lines but HOURS (Interior Preparation, Cleaning) is
 *     real crew work: it becomes an area with one custom surface, so the job
 *     sheet carries it and the tray's hours are the PaintScout hours. An area
 *     with a price and no hours (scaffolding, a lift, travel, plastering…) is
 *     a line item; a heading with neither is a hidden $0 line, so the block
 *     count still matches the pack.
 *   · A line whose name maps to nothing keeps its PaintScout name on the
 *     `Custom surface (imported)` rate row (migration 20270152): the builder
 *     drops a surface with a blank code from both documents.
 */

import { priceEstimateTotals, type BlockInput, type PricingContext } from "@/lib/pricing/estimate";
import { adjustmentsFrom } from "@/lib/pricing/context";
import type { CustomerSnapshot, SnapshotArea, SnapshotLine } from "@/lib/customer/snapshot";
import { DEFAULT_PROOF } from "@/lib/customer/snapshot";
import type { WOArea, WorkOrderDoc } from "@/lib/workorder/snapshot";
import { finishFromModifier } from "@/lib/workorder/finish";
import type { BookedItem, BookedJob, SubstrateMapRow } from "./types";

export const CUSTOM_SURFACE_CODE = "Custom surface (imported)";
export const IMPORT_NAME = "paintscout-booked";
/** Tom's standard deposit; the 30-40-30 jobs stay 50 here (B1.4). */
export const IMPORT_DEPOSIT_PCT = 50;

/** Third-party pass-throughs: a line the customer pays us for and we pay a
 *  supplier for (B1.3 · ⚑ Tom to confirm the true costs later). */
const THIRD_PARTY = /scaffold|scissor|lift|plaster|carpentry|render|access equipment/i;

type Side = "Interior" | "Exterior";

// ---- the builder's shapes (structural mirrors of QuoteBuilder.tsx) --------------

export type ImportSurface = {
  id: number; code: string; internalLabel: string; clientLabel: string; coats: number; count: number;
  size: null; hidden: false; isOption: false; media: never[];
  measureL: null; measureH: null; qtyOverride: number | null; rateOverride: null;
  paintingHrOverride: number; prepHr: 0; priceOverride: number;
  productName: null; color: ""; colorHex: ""; coverageOverride: null; volumeOverride: 0; unitPriceOverride: null;
  crewNote: string; hideQty: boolean; showCoats: boolean; showPrice: false; useCustomRate: false; customRate: null; open: false;
};

export type ImportArea = {
  id: number; kind: "area"; name: string; type: Side; areaType: "room";
  L: number; W: number; H: number; isOption: false; description: string; open: false; media: never[];
  surfaces: ImportSurface[];
};

export type ImportLine = {
  id: number; kind: "line"; name: string; type: Side; mode: "custom";
  hours: 0; rate: 0; qty: 1; unitPrice: 0; custom: number; cost: 0; woHours: number;
  description: string; clientNote: ""; crewNote: ""; hidden: boolean; isOption: false; subcontractorExpense: boolean;
  media: never[]; open: false; detailsOpen: false;
};

export type ImportBlock = ImportArea | ImportLine;

export type ImportBuilderState = {
  blocks: ImportBlock[];
  modSel: Record<string, string>;
  contact: { first_name: string; last_name: string; company: string; email: string; phone: string; address: string; city: string; state: string; postal: string };
  jobAddress: { address: string; city: string; state: string; postal: string };
  materials: Record<string, never>; materialColours: Record<string, never>; sheens: Record<string, never>; colourMatches: Record<string, never>;
  depositPct: number; inclusions: string[]; exclusions: string[];
  discountPct: 0; discountMode: "pct"; discountFixedCents: 0;
  hourlyRateOverride: null; contractorRateOverride: null; preparationOverrideCents: 0;
  sizeUpliftDisabled: true;
  aiDeferred: never[]; idealPainters: number | null; photoReview: null; extraPaints: never[];
  /** Provenance for the builder and the revision diff: never re-priced by the engine. */
  imported: { source: "paintscout"; quoteNo: string; hoursPrepByArea: Record<string, number> };
  woDoc: WorkOrderDoc;
  woOptions: Record<string, never>;
};

export type CompanyLetterhead = {
  name: string; addressLine1: string; addressLine2: string; phone: string; abn: string; email: string;
  estimatorName: string; estimatorTitle: string; estimatorPhone: string; logoUrl: string; logoUrlLight?: string;
};

export type BuiltBookedJob = {
  quoteNo: string;
  title: string;
  builderState: ImportBuilderState;
  sentSnapshot: CustomerSnapshot;
  woDoc: WorkOrderDoc;
  totals: { subtotalCents: number; gstCents: number; totalCents: number; hours: number; contractorOfferCents: number | null };
  counts: { areas: number; lines: number; customLines: number };
  trayNote: string;
  externalRef: Record<string, unknown>;
  /** Cents the pro-rata split could not place evenly and put on a last surface — logged, never silent. */
  roundingNotes: string[];
};

// ---- helpers ----------------------------------------------------------------------

const sideOf = (s: "interior" | "exterior"): Side => (s === "interior" ? "Interior" : "Exterior");
const hrs = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0);
const dollars = (cents: number): number => Math.round(cents) / 100;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const lastName = (name: string) => name.trim().split(/\s+/).slice(1).join(" ");

/** "16–20 Nov 2026" / "28 Sep 2026 – 14 Nov 2026". Pure calendar-day text:
 *  the pack's dates are Melbourne days already, so no clock or zone is
 *  involved (never `new Date(ymd)`, never a written-down offset). */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateSpan(start: string, end: string): string {
  const parts = (ymd: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    return m ? { y: m[1], mon: MON[Number(m[2]) - 1] ?? m[2], d: String(Number(m[3])) } : null;
  };
  const a = parts(start);
  if (!a) return start;
  const b = end ? parts(end) : null;
  if (!b || end === start) return `${a.d} ${a.mon} ${a.y}`;
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return sameMonth ? `${a.d}–${b.d} ${b.mon} ${b.y}` : `${a.d} ${a.mon} ${a.y} – ${b.d} ${b.mon} ${b.y}`;
}

/** The tray card's line for staff (B0.3): what Airtable had planned, so the
 *  right offer goes out. Contractor emails are here and nowhere else. */
export function trayNoteFor(job: BookedJob): string {
  if (job.view === "needs" || !job.start_date) return "Airtable: needs booking.";
  const when = dateSpan(job.start_date, job.end_date);
  if (!job.assigned_painter_email && !job.assigned_painter) return `Airtable: booked ${when}, no painter assigned.`;
  const who = [job.assigned_painter, job.assigned_painter_email ? `(${job.assigned_painter_email})` : ""].filter(Boolean).join(" ");
  const accepted = /^accept/i.test(job.painter_accepted) ? " — painter accepted. Send the offer." : ` — ${job.painter_accepted || "not yet accepted"}. Send the offer.`;
  return `Airtable: booked ${when} with ${who}${accepted}`;
}

/**
 * Split an area's PaintScout price across its lines pro rata to hours,
 * rounded to cents, remainder on the last line so the area sums exactly.
 * Lines with no hours share equally when nothing in the area has hours.
 */
export function splitPriceByHours(priceCents: number, hours: number[]): number[] {
  const n = hours.length;
  if (n === 0) return [];
  const total = hours.reduce((a, b) => a + b, 0);
  const weights = total > 0 ? hours.map((h) => h / total) : hours.map(() => 1 / n);
  const out: number[] = [];
  let placed = 0;
  for (let i = 0; i < n - 1; i++) {
    const c = Math.round(priceCents * weights[i]);
    out.push(c);
    placed += c;
  }
  out.push(priceCents - placed);
  return out;
}

/** Line → rate code, consuming booked_substrate_map.csv rows in order. */
export class SubstrateResolver {
  private queues = new Map<string, SubstrateMapRow[]>();
  private byName = new Map<string, string>();
  constructor(lineMap: SubstrateMapRow[], nameMap: Array<{ paintscout_item: string; side: string; platform_rate_code: string }> = []) {
    for (const r of lineMap) {
      const k = `${r.quote_no} ${r.area} ${r.item}`;
      const q = this.queues.get(k) ?? [];
      q.push(r);
      this.queues.set(k, q);
    }
    for (const r of nameMap) this.byName.set(`${r.paintscout_item.trim().toLowerCase()} ${r.side}`, r.platform_rate_code);
  }
  resolve(quoteNo: string, area: string, item: BookedItem, jobSide: "interior" | "exterior"): { code: string; custom: boolean; side: Side; internalLabel: string; clientLabel: string } {
    const q = this.queues.get(`${quoteNo} ${area} ${item.item}`);
    const row = q?.shift();
    if (row) {
      const custom = !row.rate_code;
      return {
        code: custom ? CUSTOM_SURFACE_CODE : row.rate_code, custom, side: sideOf(row.side),
        internalLabel: row.internal_label || item.item, clientLabel: row.client_label || item.item,
      };
    }
    const named = this.byName.get(`${item.item.trim().toLowerCase()} ${jobSide}`);
    return { code: named || CUSTOM_SURFACE_CODE, custom: !named, side: sideOf(jobSide), internalLabel: item.item, clientLabel: item.item };
  }
  /** Rows the jobs never asked for — a map out of step with the pack. */
  unconsumed(): number {
    let n = 0;
    for (const q of this.queues.values()) n += q.length;
    return n;
  }
}

// ---- the build ---------------------------------------------------------------------

export function buildBookedJob(
  job: BookedJob,
  resolver: SubstrateResolver,
  ctx: PricingContext,
  company: CompanyLetterhead,
  shareToken: string,
): BuiltBookedJob {
  const jobSide = sideOf(job.job_type_norm);
  const blocks: ImportBlock[] = [];
  const roundingNotes: string[] = [];
  const hoursPrepByArea: Record<string, number> = {};
  let nextId = 1;
  let customLines = 0;

  for (const area of job.areas) {
    const price = area.price_ex_gst_cents ?? 0;
    const areaHours = hrs(area.hours_total);
    if (area.items.length > 0) {
      const resolved = area.items.map((it) => resolver.resolve(job.quote_no, area.name, it, job.job_type_norm));
      const side = resolved[0]?.side ?? jobSide;
      const lineHours = area.items.map((it) => hrs(it.hours));
      const shares = splitPriceByHours(price, lineHours);
      const sumShares = shares.reduce((a, b) => a + b, 0);
      if (sumShares !== price) throw new Error(`area ${job.quote_no}/${area.name}: split ${sumShares} ≠ ${price}`);
      const last = shares[shares.length - 1];
      const evenLast = Math.round(price * (lineHours[lineHours.length - 1] / Math.max(lineHours.reduce((a, b) => a + b, 0), 1e-9)));
      if (lineHours.some((h) => h > 0) && Math.abs(last - evenLast) > 0 && shares.length > 1) {
        roundingNotes.push(`${job.quote_no} ${area.name}: ${last - evenLast} cent(s) on the last surface`);
      }
      const areaId = nextId++;
      const surfaces: ImportSurface[] = area.items.map((it, i) => {
        const r = resolved[i];
        if (r.custom) customLines++;
        const qty = typeof it.qty === "number" && it.qty > 0 ? it.qty : 0;
        return {
          id: nextId++, code: r.code, internalLabel: r.internalLabel, clientLabel: r.clientLabel,
          coats: typeof it.coats === "number" && it.coats > 0 ? Math.round(it.coats) : 1,
          count: qty, size: null, hidden: false, isOption: false, media: [],
          measureL: null, measureH: null, qtyOverride: qty > 0 ? qty : null, rateOverride: null,
          paintingHrOverride: lineHours[i], prepHr: 0, priceOverride: dollars(shares[i]),
          productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: 0, unitPriceOverride: null,
          crewNote: it.unit === "m2" ? `${qty} m²` : it.unit === "m" ? `${qty} m` : "", hideQty: false, showCoats: true, showPrice: false,
          useCustomRate: false, customRate: null, open: false,
        };
      });
      const prep = hrs(area.hours_prep);
      if (prep > 0) hoursPrepByArea[String(areaId)] = prep;
      blocks.push({
        id: areaId, kind: "area", name: area.name, type: side, areaType: "room",
        L: area.length_m ?? 0, W: area.width_m ?? 0, H: area.height_m ?? 0, isOption: false,
        description: prep > 0 ? `<p>Preparation ${prep} h (included in the hours below).</p>` : "",
        open: false, media: [], surfaces,
      });
      continue;
    }
    if (areaHours > 0) {
      // Crew work with no substrate lines (Interior Preparation, Cleaning): one
      // custom surface so the job sheet and the tray carry the hours.
      const areaId = nextId++;
      customLines++;
      blocks.push({
        id: areaId, kind: "area", name: area.name, type: jobSide, areaType: "room",
        L: 0, W: 0, H: 0, isOption: false, description: "", open: false, media: [],
        surfaces: [{
          id: nextId++, code: CUSTOM_SURFACE_CODE, internalLabel: area.name, clientLabel: area.name, coats: 1, count: 1,
          size: null, hidden: false, isOption: false, media: [], measureL: null, measureH: null, qtyOverride: 1, rateOverride: null,
          paintingHrOverride: areaHours, prepHr: 0, priceOverride: dollars(price),
          productName: null, color: "", colorHex: "", coverageOverride: null, volumeOverride: 0, unitPriceOverride: null,
          crewNote: "", hideQty: true, showCoats: false, showPrice: false, useCustomRate: false, customRate: null, open: false,
        }],
      });
      continue;
    }
    // A priced line with no hours, or a bare heading (hidden, $0).
    const heading = price === 0;
    blocks.push({
      id: nextId++, kind: "line", name: area.name, type: jobSide, mode: "custom",
      hours: 0, rate: 0, qty: 1, unitPrice: 0, custom: dollars(price), cost: 0, woHours: 0,
      description: "", clientNote: "", crewNote: "", hidden: heading, isOption: false,
      subcontractorExpense: !heading && THIRD_PARTY.test(area.name),
      media: [], open: false, detailsOpen: false,
    });
  }

  if (job.discount_ex_gst_cents < 0) {
    blocks.push({
      id: nextId++, kind: "line", name: job.discount_label || "Discount", type: jobSide, mode: "custom",
      hours: 0, rate: 0, qty: 1, unitPrice: 0, custom: dollars(job.discount_ex_gst_cents), cost: 0, woHours: 0,
      description: "", clientNote: "", crewNote: "", hidden: false, isOption: false, subcontractorExpense: false,
      media: [], open: false, detailsOpen: false,
    });
  }

  const modSel = { "Level of Finish": `FIN-${job.level_of_finish}` };
  const address = job.address || job.paintscout_address;
  const contact = {
    first_name: firstName(job.customer_name), last_name: lastName(job.customer_name), company: "",
    email: job.email, phone: job.phone, address, city: job.suburb, state: "VIC", postal: job.postcode,
  };
  const jobAddress = { address, city: job.suburb, state: "VIC", postal: job.postcode };
  const stateWithoutDocs = {
    blocks, modSel, contact, jobAddress,
    materials: {}, materialColours: {}, sheens: {}, colourMatches: {},
    depositPct: IMPORT_DEPOSIT_PCT, inclusions: [] as string[], exclusions: [] as string[],
    discountPct: 0 as const, discountMode: "pct" as const, discountFixedCents: 0 as const,
    hourlyRateOverride: null, contractorRateOverride: null, preparationOverrideCents: 0 as const,
    sizeUpliftDisabled: true as const,
    aiDeferred: [], idealPainters: job.number_of_workers > 0 ? job.number_of_workers : null, photoReview: null, extraPaints: [],
    imported: { source: "paintscout" as const, quoteNo: job.quote_no, hoursPrepByArea },
  };

  // A code the active card does not carry prices at NOTHING (lib/pricing
  // ignores the override on the no-item branch), so a missing row would
  // quietly short the total. Refuse before the engine runs.
  const known = new Set(ctx.rateItems.map((r) => r.code));
  for (const b of blocks) {
    if (b.kind !== "area") continue;
    for (const s of b.surfaces) {
      if (!known.has(s.code)) throw new Error(`quote ${job.quote_no}: rate code "${s.code}" is not on the active rate card — apply migration 20270152 or fix the substrate map`);
    }
  }

  // The engine's own arithmetic over the state — the proof (B0.1).
  const totals = priceEstimateTotals(blocks as unknown as BlockInput[], ctx, adjustmentsFrom(stateWithoutDocs as unknown as Record<string, unknown>));
  if (totals.subtotalCents !== job.subtotal_ex_gst_cents || totals.totalCents !== job.total_inc_gst_cents) {
    throw new Error(
      `quote ${job.quote_no}: the engine over the built state gives subtotal ${totals.subtotalCents} / total ${totals.totalCents}, ` +
      `PaintScout says ${job.subtotal_ex_gst_cents} / ${job.total_inc_gst_cents} — refusing to write it`,
    );
  }
  const hours = Math.round(blocks.reduce((n, b) => n + (b.kind === "area" ? b.surfaces.reduce((m, s) => m + s.paintingHrOverride, 0) : b.woHours), 0) * 100) / 100;
  if (Math.abs(hours - job.total_hours) > 0.011) {
    throw new Error(`quote ${job.quote_no}: built hours ${hours} ≠ PaintScout ${job.total_hours}`);
  }

  const jobAddressText = [address, job.suburb, "VIC", job.postcode].filter(Boolean).join(", ");
  const title = job.project_name;

  // ---- the customer document (buildCustomerDoc's shape, no paints/presentation) ----
  const areasDoc: SnapshotArea[] = [];
  const lineItems: SnapshotLine[] = [];
  for (const b of blocks) {
    if (b.kind === "area") {
      areasDoc.push({
        id: String(b.id), title: b.name, descriptionHtml: b.description,
        priceCents: b.surfaces.reduce((n, s) => n + Math.round(s.priceOverride * 100), 0),
        surfaces: b.surfaces.map((s) => ({ label: s.clientLabel || s.code, coats: s.coats, product: "" })),
        photos: [],
      });
    } else if (!b.hidden) {
      lineItems.push({ id: String(b.id), title: b.name, descriptionHtml: "", priceCents: Math.round(b.custom * 100) });
    }
  }
  const sentSnapshot: CustomerSnapshot = {
    version: 1,
    company: {
      name: company.name, addressLine1: company.addressLine1, addressLine2: company.addressLine2, phone: company.phone,
      abn: company.abn, email: company.email, estimatorName: company.estimatorName, estimatorTitle: company.estimatorTitle,
      estimatorPhone: company.estimatorPhone, logoUrl: company.logoUrl, logoUrlLight: company.logoUrlLight,
    },
    estRef: shareToken.slice(0, 8).toUpperCase(),
    contactName: job.customer_name,
    contactEmail: job.email,
    jobAddress: jobAddressText,
    jobTitle: title,
    gstRatePct: 10,
    depositPct: IMPORT_DEPOSIT_PCT,
    baseSubtotalCents: totals.subtotalCents,
    preparation: null,
    areas: areasDoc, lineItems, options: [],
    paints: [],
    inclusions: [], exclusions: [],
    presentation: null,
    terms: "",
    discountMode: "pct", discountPct: 0, discountFixedCents: 0,
    proof: DEFAULT_PROOF,
  };

  // ---- the job sheet (computeWorkOrderDoc's shape) ----
  const finishCode = finishFromModifier(modSel["Level of Finish"]);
  const woAreas: WOArea[] = blocks.filter((b): b is ImportArea => b.kind === "area").map((b) => ({
    id: String(b.id), title: b.name, photos: [], finishCode, finishOverridden: false,
    surfaces: b.surfaces.map((s) => ({
      key: `${b.id}:${s.id}`, label: s.clientLabel || s.code, coats: s.coats, product: "",
      prep: s.crewNote || "", hours: s.paintingHrOverride, paintingHours: s.paintingHrOverride, prepHours: 0, conditionHours: 0,
      status: "not_started" as const,
    })),
  }));
  const woDoc: WorkOrderDoc = {
    version: 1,
    woRef: `PS-${job.quote_no}`,
    status: "issued",
    jobTitle: title,
    jobAddress: jobAddressText,
    contactFirstName: firstName(job.customer_name),
    contactPhone: job.phone,
    startDate: null,
    accessNotes: "",
    crewNotes: "",
    levelOfFinish: `Level ${job.level_of_finish}`,
    finishCode,
    condition: null,
    contractorName: "",
    contractorPaymentCents: job.contractor_offer_cents ?? totals.contractorOfferCents,
    materials: [],
    areas: woAreas,
    exclusions: [],
    inclusions: [],
    company: { name: company.name, phone: company.phone, logoUrl: company.logoUrl },
    idealPainters: stateWithoutDocs.idealPainters,
    appliedOptions: [],
  };

  const builderState: ImportBuilderState = { ...stateWithoutDocs, woDoc, woOptions: {} };
  const externalRef = {
    quote_no: job.quote_no, quote_url: job.quote_url, work_order_url: job.work_order_url,
    airtable_status: job.airtable_status, view: job.view,
    discount_label: job.discount_label || null, discount_ex_gst_cents: job.discount_ex_gst_cents,
    options_accepted_ex_gst_cents: job.options_accepted_ex_gst_cents,
    level_of_finish_assumed: job.level_of_finish_assumed === "yes",
    airtable_start_date: job.start_date || null, airtable_end_date: job.end_date || null,
    airtable_painter: job.assigned_painter || null, airtable_painter_email: job.assigned_painter_email || null,
    airtable_painter_accepted: job.painter_accepted || null, airtable_workers: job.number_of_workers,
    airtable_estimated_hours: job.airtable_estimated_hours ?? null, estimated_materials_cents: job.estimated_materials_cents ?? null,
    deposit_recorded: job.deposit_recorded === "yes", airtable_notes: job.notes || null, import_note: job.import_note || null,
    hours_pending: false,
  };

  return {
    quoteNo: job.quote_no, title, builderState, sentSnapshot, woDoc,
    totals: { subtotalCents: totals.subtotalCents, gstCents: totals.gstCents, totalCents: totals.totalCents, hours, contractorOfferCents: job.contractor_offer_cents ?? null },
    counts: { areas: job.areas.length, lines: job.areas.reduce((n, a) => n + a.items.length, 0), customLines },
    trayNote: trayNoteFor(job),
    externalRef,
    roundingNotes,
  };
}
