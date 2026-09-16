/**
 * Part C · the handover feed. One Airtable Projects record as the Zap posts it
 * (brief C2: numbers as text, dates as text or epoch ms), plus the PaintScout
 * quote the Zap fetched in its second step, → the same `BookedJob` shape Part
 * B builds from. The quote gives area prices and the job's TOTAL hours, never
 * per-line hours, so every area arrives as a priced area with no lines: the
 * office types the per-area hours from the PaintScout work order (Tom's C-1
 * ruling, 16 Sep 2026) and the job carries `hours_pending` until then.
 */

import { z } from "zod";
import type { BookedArea, BookedJob } from "./types";

const text = z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => (v == null ? "" : String(v).trim()));
const money = z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
});

/** A PaintScout quote item as Zapier flattens it: name + price, either as an array of objects or parallel lists. */
const psItem = z.object({ name: text, price: money, hours: money.optional() });

export const zapJobSchema = z.object({
  record_id: z.string().trim().min(1).max(200),
  view: z.enum(["future_booked_jobs", "needs_booking"]),
  quote_no: text.pipe(z.string().min(1, "Quote No is required").max(20)),
  project_name: text,
  status: text,
  first_name: text,
  last_name: text,
  email: text,
  phone: text,
  address: text,
  suburb: text,
  postcode: text,
  job_type: text,
  level_of_finish: text,
  start_date: text,
  end_date: text,
  workers: text,
  painter_email: text,
  painter_accepted: text,
  offered_amount: money,
  invoice_amount: money,
  estimated_hours: money,
  notes: text,
  quote_url: text,
  work_order_url: text,
  ps_items: z.union([z.array(psItem), z.string(), z.null(), z.undefined()]).transform((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim().startsWith("[")) {
      try { return z.array(psItem).parse(JSON.parse(v)); } catch { return []; }
    }
    return [];
  }),
  ps_total_hours: money,
  ps_subtotal: money,
  ps_total_inc: money,
  ps_status: text,
  ps_accepted_at: text,
});
export type ZapJob = z.infer<typeof zapJobSchema>;

const toYmd = (raw: string): string => {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const ms = /^\d{12,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(ms)) return "";
  // Airtable dates are Melbourne days; format the instant in Melbourne, never UTC.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
};

const toMs = (raw: string): number | null => {
  if (!raw) return null;
  const ms = /^\d{12,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
};

export type ZapConversion = { ok: true; job: BookedJob; flags: string[] } | { ok: false, reason: string };

/** The Zap record → a BookedJob. Refuses when the figures cannot make a job (no total, no areas). */
export function bookedJobFromZap(z: ZapJob, now: Date = new Date()): ZapConversion {
  const flags: string[] = [];
  const cents = (dollars: number | null) => (dollars == null ? null : Math.round(dollars * 100));
  const subtotal = cents(z.ps_subtotal);
  const totalInc = cents(z.ps_total_inc);
  if (subtotal == null || subtotal <= 0 || totalInc == null || totalInc <= 0) return { ok: false, reason: "the PaintScout quote has no subtotal / total" };
  const items = z.ps_items.filter((i) => i.name);
  if (items.length === 0) return { ok: false, reason: "the PaintScout quote has no items" };

  const areas: BookedArea[] = items.map((i) => ({
    name: i.name, price_ex_gst_cents: cents(i.price), hours_prep: null, hours_paint: null, hours_total: null,
    length_m: null, width_m: null, height_m: null, items: [],
  }));
  const priced = areas.reduce((n, a) => n + (a.price_ex_gst_cents ?? 0), 0);
  // The quote's subtotal is net of any discount; the items are gross. The
  // difference is the discount, and it must be a discount, not a shortfall.
  const discount = subtotal - priced;
  if (discount > 0) return { ok: false, reason: `the items ($${(priced / 100).toFixed(2)}) come to less than the subtotal ($${(subtotal / 100).toFixed(2)})` };
  const gst = totalInc - subtotal;
  if (gst !== Math.round(subtotal * 0.1)) return { ok: false, reason: `GST does not reconcile (subtotal ${subtotal}, total ${totalInc})` };

  const level = Number((z.level_of_finish.match(/[234]/) ?? ["3"])[0]) as 2 | 3 | 4;
  if (!/[234]/.test(z.level_of_finish)) flags.push("level_of_finish assumed Level 3");
  const painterAccepted = /^accept/i.test(z.painter_accepted) ? "Accepted" : z.painter_accepted;
  const jobSide: "interior" | "exterior" = /exterior/i.test(z.job_type) && !/interior/i.test(z.job_type) ? "exterior" : "interior";
  const acceptedMs = toMs(z.ps_accepted_at) ?? now.getTime();
  if (!toMs(z.ps_accepted_at)) flags.push("no acceptance date on the quote — using the import time");
  const hours = z.ps_total_hours ?? z.estimated_hours ?? 0;
  if (!hours) flags.push("no hours on the quote");

  const job: BookedJob = {
    quote_no: z.quote_no, view: z.view === "needs_booking" ? "needs" : "booked", airtable_status: z.status,
    project_name: z.project_name || z.address || `Quote ${z.quote_no}`,
    customer_name: [z.first_name, z.last_name].filter(Boolean).join(" ") || z.email || z.phone,
    email: z.email.toLowerCase(), phone: z.phone, account_key: "",
    address: z.address, suburb: z.suburb, postcode: z.postcode, paintscout_address: "",
    job_type: z.job_type, job_type_norm: jobSide, level_of_finish: level, level_of_finish_assumed: /[234]/.test(z.level_of_finish) ? "" : "yes",
    quote_url: z.quote_url, work_order_url: z.work_order_url,
    subtotal_ex_gst_cents: subtotal, gst_cents: gst, total_inc_gst_cents: totalInc,
    discount_ex_gst_cents: discount, discount_label: discount < 0 ? "Discount" : "", options_accepted_ex_gst_cents: 0,
    // The pack's total is line hours + hours-only areas; with no lines the
    // areas carry nothing and the job's hours are pending. total_hours 0
    // keeps the build's own check honest.
    total_hours: 0, airtable_estimated_hours: hours || null, estimated_materials_cents: null,
    contractor_offer_cents: cents(z.offered_amount),
    start_date: toYmd(z.start_date), end_date: toYmd(z.end_date), number_of_workers: Math.max(0, Math.round(Number(z.workers) || 0)),
    assigned_painter: "", assigned_painter_email: z.painter_email.toLowerCase(), painter_accepted: painterAccepted,
    date_accepted_ms: acceptedMs, deposit_recorded: "", notes: z.notes, import_note: `Zapier · Airtable record ${z.record_id} · view ${z.view}`,
    areas,
  };
  if (!job.customer_name) return { ok: false, reason: "no customer name, email or phone" };
  return { ok: true, job, flags };
}
