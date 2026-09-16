import { describe, expect, it } from "vitest";
import { bookedJobFromZap, zapJobSchema } from "./zap";
import { buildBookedJob, SubstrateResolver, type CompanyLetterhead } from "./build";
import type { PricingContext } from "@/lib/pricing/estimate";

const COMPANY: CompanyLetterhead = { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" };
const CTX: PricingContext = {
  rateItems: [
    { code: "Custom surface (imported)", category: "Interior", unit: "Hours Per Item", rate_1_coat: 1, rate_2_coat: 1, rate_3_coat: 1, charge_out_cents: 8500 },
    { code: "Custom surface (imported)", category: "Exterior", unit: "Hours Per Item", rate_1_coat: 1, rate_2_coat: 1, rate_3_coat: 1, charge_out_cents: 10000 },
  ],
  products: [], modifiers: [], settings: [{ key: "GST", value: { value: 0.1 } }, { key: "Sundries per job — interior", value: { value: 275 } }],
};

/** What Zapier posts (brief C2): everything as text. */
const RECORD = {
  record_id: "recNEW123", view: "future_booked_jobs", quote_no: "3701", project_name: "14 Handover Street", status: "Job Booked",
  first_name: "Hana", last_name: "Handover", email: "PG.E2E.Handover@example.com", phone: "0491 570 157", address: "14 Handover Street", suburb: "Testville", postcode: "3000",
  job_type: "Interior Residential", level_of_finish: "Level 3", start_date: "2026-10-05", end_date: "2026-10-07", workers: "2",
  painter_email: "", painter_accepted: "", offered_amount: "1,200.00", invoice_amount: "3300", estimated_hours: "20",
  notes: "Keys under the mat", quote_url: "https://app.paintscout.com/view/?u=abc", work_order_url: "https://app.paintscout.com/view/?u=def",
  ps_items: [{ name: "Interior Preparation", price: "300" }, { name: "Lounge", price: "2000" }, { name: "Cleaning", price: "700" }],
  ps_total_hours: "20", ps_subtotal: "3000", ps_total_inc: "3300", ps_status: "accepted", ps_accepted_at: "2026-09-10T03:00:00Z",
};

describe("handover feed · Zap record → BookedJob", () => {
  it("rejects a record with no Quote No", () => {
    expect(zapJobSchema.safeParse({ ...RECORD, quote_no: "" }).success).toBe(false);
    expect(zapJobSchema.safeParse({ ...RECORD, quote_no: undefined }).success).toBe(false);
    expect(zapJobSchema.safeParse({ ...RECORD, record_id: "" }).success).toBe(false);
  });

  it("turns the quote's items into priced areas with no lines, and the job builds with hours pending", () => {
    const conv = bookedJobFromZap(zapJobSchema.parse(RECORD));
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;
    expect(conv.job).toMatchObject({
      quote_no: "3701", view: "booked", customer_name: "Hana Handover", email: "pg.e2e.handover@example.com", job_type_norm: "interior", level_of_finish: 3,
      subtotal_ex_gst_cents: 300000, gst_cents: 30000, total_inc_gst_cents: 330000, discount_ex_gst_cents: 0, contractor_offer_cents: 120000,
      start_date: "2026-10-05", end_date: "2026-10-07", number_of_workers: 2, date_accepted_ms: Date.parse("2026-09-10T03:00:00Z"), total_hours: 0,
    });
    expect(conv.job.areas.map((a) => [a.name, a.price_ex_gst_cents, a.items.length])).toEqual([["Interior Preparation", 30000, 0], ["Lounge", 200000, 0], ["Cleaning", 70000, 0]]);
    const built = buildBookedJob(conv.job, new SubstrateResolver([]), CTX, COMPANY, "token12345678901234567890");
    expect(built.totals).toMatchObject({ subtotalCents: 300000, totalCents: 330000, hours: 0 });
    // Priced, hour-less areas are line items until the office types the hours.
    expect(built.builderState.blocks.every((b) => b.kind === "line")).toBe(true);
    expect(built.woDoc.areas).toEqual([]);
    expect(built.trayNote).toBe("Airtable: booked 5–7 Oct 2026, no painter assigned.");
  });

  it("a discount on the quote is the gap between the items and the subtotal", () => {
    const conv = bookedJobFromZap(zapJobSchema.parse({ ...RECORD, ps_subtotal: "2800", ps_total_inc: "3080" }));
    expect(conv.ok && conv.job.discount_ex_gst_cents).toBe(-20000);
    const short = bookedJobFromZap(zapJobSchema.parse({ ...RECORD, ps_subtotal: "3200", ps_total_inc: "3520" }));
    expect(short.ok).toBe(false);
  });

  it("refuses a quote with no money or no items, flags an assumed level and a missing acceptance date", () => {
    expect(bookedJobFromZap(zapJobSchema.parse({ ...RECORD, ps_subtotal: "" })).ok).toBe(false);
    expect(bookedJobFromZap(zapJobSchema.parse({ ...RECORD, ps_items: [] })).ok).toBe(false);
    const flagged = bookedJobFromZap(zapJobSchema.parse({ ...RECORD, level_of_finish: "", ps_accepted_at: "" }), new Date("2026-09-16T00:00:00Z"));
    expect(flagged.ok && flagged.flags).toEqual(["level_of_finish assumed Level 3", "no acceptance date on the quote — using the import time"]);
    expect(flagged.ok && flagged.job.level_of_finish_assumed).toBe("yes");
  });

  it("a needs-booking record has no dates and says so in the tray note", () => {
    const conv = bookedJobFromZap(zapJobSchema.parse({ ...RECORD, view: "needs_booking", start_date: "", end_date: "" }));
    expect(conv.ok && conv.job.view).toBe("needs");
    if (!conv.ok) return;
    const built = buildBookedJob(conv.job, new SubstrateResolver([]), CTX, COMPANY, "token12345678901234567890");
    expect(built.trayNote).toBe("Airtable: needs booking.");
  });

  it("an epoch-ms date from Zapier is a Melbourne day", () => {
    // 2026-10-04T15:00:00Z is already 5 Oct in Melbourne (AEDT, +11).
    const conv = bookedJobFromZap(zapJobSchema.parse({ ...RECORD, start_date: String(Date.parse("2026-10-04T15:00:00Z")), end_date: "" }));
    expect(conv.ok && conv.job.start_date).toBe("2026-10-05");
  });
});
