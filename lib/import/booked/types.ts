/**
 * Part B · the shape of one signed PaintScout job as the pack holds it
 * (docs/imports/airtable-crm-import/booked/booked_jobs.json) and as the
 * handover door receives it. Validated with zod before anything is built —
 * a row that does not fit is refused, never guessed at.
 */

import { z } from "zod";

const num = z.coerce.number();
const intCents = z.coerce.number().int();
const nullableNum = z.union([z.number(), z.null()]).transform((v) => (v == null ? null : v));
/** A text field the pack may leave null: null → "". */
const nstr = (max: number) => z.union([z.string().max(max), z.null()]).transform((v) => (v ?? "").trim()).default("");

export const bookedItemSchema = z.object({
  item: z.string().trim().min(1).max(200),
  qty: nullableNum,
  unit: z.enum(["m2", "m", "count"]),
  hours: nullableNum,
  coats: nullableNum,
  /** The product PaintScout printed on the line ("Dulux Weathershield"); the
   *  work-order page carries it, the pack and the Zap feed do not. */
  product: nstr(120).optional(),
});
export type BookedItem = z.infer<typeof bookedItemSchema>;

export const bookedAreaSchema = z.object({
  name: z.string().trim().min(1).max(200),
  price_ex_gst_cents: z.union([z.number().int(), z.null()]),
  hours_prep: nullableNum,
  hours_paint: nullableNum,
  hours_total: nullableNum,
  length_m: nullableNum,
  width_m: nullableNum,
  height_m: nullableNum,
  items: z.array(bookedItemSchema).default([]),
});
export type BookedArea = z.infer<typeof bookedAreaSchema>;

export const bookedJobSchema = z.object({
  quote_no: z.string().trim().min(1).max(20),
  view: z.enum(["booked", "needs"]),
  airtable_status: nstr(80),
  project_name: z.string().trim().min(1).max(200),
  customer_name: z.string().trim().min(1).max(200),
  email: nstr(200),
  phone: nstr(40),
  account_key: nstr(40),
  address: nstr(300),
  suburb: nstr(100),
  postcode: nstr(10),
  paintscout_address: nstr(300),
  job_type: nstr(80),
  job_type_norm: z.enum(["interior", "exterior"]),
  level_of_finish: z.coerce.number().int().refine((n) => n === 2 || n === 3 || n === 4, "level_of_finish must be 2, 3 or 4"),
  level_of_finish_assumed: nstr(10),
  quote_url: nstr(400),
  work_order_url: nstr(400),
  subtotal_ex_gst_cents: intCents.positive(),
  gst_cents: intCents.nonnegative(),
  total_inc_gst_cents: intCents.positive(),
  discount_ex_gst_cents: intCents.nonpositive().default(0),
  discount_label: nstr(200),
  options_accepted_ex_gst_cents: intCents.nonnegative().default(0),
  total_hours: num.nonnegative(),
  airtable_estimated_hours: z.union([z.number(), z.string(), z.null()]).optional(),
  estimated_materials_cents: z.union([z.number().int(), z.null()]).optional(),
  contractor_offer_cents: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  start_date: nstr(10),
  end_date: nstr(10),
  number_of_workers: z.union([z.number(), z.string(), z.null()]).transform((v) => Math.max(0, Math.round(Number(v ?? 0)) || 0)).default(0),
  assigned_painter: nstr(120),
  assigned_painter_email: nstr(200),
  painter_accepted: nstr(40),
  /** Epoch ms as text or number; one pack row (1460) carries an ISO timestamp instead — both are a moment, so both are accepted. */
  date_accepted_ms: z.union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Date.parse(v)))
    .refine((n) => Number.isFinite(n) && n > 1_500_000_000_000, "date_accepted_ms must be an epoch in ms or an ISO timestamp"),
  deposit_recorded: nstr(10),
  notes: nstr(4000),
  import_note: nstr(1000),
  dims: z.record(z.string(), z.unknown()).optional(),
  areas: z.array(bookedAreaSchema).min(1),
  /** The work-order page's "Product Description" block: each product and
   *  PaintScout's estimated litres. Absent from the pack and the Zap feed. */
  materials: z.array(z.object({ product: z.string().trim().min(1).max(120), litres: nullableNum })).optional(),
});
export type BookedJob = z.infer<typeof bookedJobSchema>;

/** One row of booked_substrate_map.csv: a work-order line → its rate code. */
export const substrateMapRowSchema = z.object({
  quote_no: z.string(),
  area: z.string(),
  item: z.string(),
  unit: z.string(),
  qty: z.string(),
  coats: z.string(),
  hours: z.string(),
  side: z.enum(["interior", "exterior"]),
  rate_code: z.string(),
  match: z.enum(["exact", "keyword", "custom"]),
  internal_label: z.string(),
  client_label: z.string(),
});
export type SubstrateMapRow = z.infer<typeof substrateMapRowSchema>;

export function parseBookedJobs(raw: unknown): BookedJob[] {
  const parsed = z.array(bookedJobSchema).min(1).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`booked_jobs.json does not fit: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const seen = new Set<string>();
  for (const j of parsed.data) {
    if (seen.has(j.quote_no)) throw new Error(`quote ${j.quote_no} appears twice in the pack`);
    seen.add(j.quote_no);
  }
  return parsed.data;
}
