import { describe, expect, it } from "vitest";
import { jobFromWorkOrder, pricedBlocksOf, type ExistingImportedJob } from "./fill";
import { parseWorkOrderText } from "./workorder-text";
import { buildBookedJob, CUSTOM_SURFACE_CODE, SubstrateResolver, type CompanyLetterhead } from "./build";
import { bookedJobFromZap, zapJobSchema } from "./zap";
import type { PricingContext } from "@/lib/pricing/estimate";

/**
 * The handover door writes a job with the quote's priced areas and no lines
 * (zap.ts); the work-order page adds the lines and hours. The join must keep
 * the signed total to the cent — buildBookedJob is the proof, run here over
 * the joined job exactly as the script runs it.
 */

const COMPANY: CompanyLetterhead = {
  name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "",
  estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "",
};

function ctxFor(codes: Iterable<string>): PricingContext {
  const rateItems: PricingContext["rateItems"] = [];
  for (const code of new Set([...codes, CUSTOM_SURFACE_CODE])) {
    for (const category of ["Interior", "Exterior"] as const) {
      rateItems.push({ code, category, sub_category: "Imported", unit: "Hours Per Item", rate_1_coat: 1, rate_2_coat: 1, rate_3_coat: 1, default_coats: 1, charge_out_cents: category === "Interior" ? 8500 : 10000 });
    }
  }
  return {
    rateItems, products: [], modifiers: [{ code: "FIN-3", group_name: "Level of Finish", multiplier: 1 }],
    settings: [
      { key: "GST", value: { value: 0.1 } },
      { key: "Sundries per job — interior", value: { value: 275 } }, { key: "Sundries per job — exterior", value: { value: 175 } },
      { key: "Margin uplift — tier 1 %", value: { value: 5 } }, { key: "Margin uplift — tier 1 threshold", value: { value: 10000 } },
      { key: "Contractor rate", value: { value: 60 } },
    ],
  };
}

/** The job as the Zap door wrote it: three priced areas, one $0 heading, no lines, no hours. */
function zapped() {
  const rec = zapJobSchema.parse({
    record_id: "recTEST", view: "future_booked_jobs", quote_no: "9613", project_name: "1 Example Street", status: "Job Booked",
    first_name: "Casey", last_name: "Example", email: "casey@example.com", phone: "0491570159", address: "1 Example Street", suburb: "Testville", postcode: "3000",
    job_type: "Exterior Residential", level_of_finish: "Level 3", start_date: "2026-10-05", end_date: "2026-10-07", workers: "2",
    painter_email: "", painter_accepted: "", offered_amount: "1500", invoice_amount: "3300", estimated_hours: "31.5",
    notes: "", quote_url: "https://example.com/q", work_order_url: "",
    ps_items: [
      { name: "Exterior Preparation", price: "0" }, { name: "Front Side", price: "1200" }, { name: "Front Side", price: "300" },
      { name: "Living Area Wall x 1", price: "250" }, { name: "Cleaning", price: "150" }, { name: "Scaffolding", price: "1100" },
    ],
    ps_total_hours: "31.5", ps_subtotal: "3000", ps_total_inc: "3300", ps_status: "accepted", ps_accepted_at: "2026-09-10T03:00:00Z",
  });
  const conv = bookedJobFromZap(rec);
  if (!conv.ok) throw new Error(conv.reason);
  const ctx = ctxFor([]);
  const built = buildBookedJob(conv.job, new SubstrateResolver([]), ctx, COMPANY, "tokentokentokentokentoken");
  const existing: ExistingImportedJob = {
    quoteNo: "9613", title: built.title, levelOfFinish: 3, subtotalCents: 300000, totalCents: 330000,
    acceptedAt: "2026-09-10T03:00:00.000Z", acceptedName: "Casey Example", contractorPaymentCents: 150000,
    builderState: built.builderState, externalRef: { ...built.externalRef, hours_pending: true },
  };
  return { existing, ctx };
}

const WO_TEXT = `Estimate ID
9613
Total Hours
31.5
Product Description
Dulux Weathershield  (Estimated: 38 Litre - $874.00)
Areas
Exterior Preparation
hr
We will wash all exterior surfaces.
Total
Front Side
(15'x3')
hr
Soffits / Eaves (15m)
Dulux Weathershield  - 1.88 Litre - $43.12
Coats: 2
4
Doors (4)
Dulux Weathershield  - 2.40 Litre - $55.20
Coats: 2
6
Total
Painting: 10
=
10
Front Side
(15'x3')
hr
Gutters (15m)
Dulux Weathershield  - 3.00 Litre - $69.00
Coats: 2
2
Total
Painting: 2
=
2
Living Area Wall x 1
(4'x3.2'x2.4')
hr
Walls (12.8m²)
Haymes Expressions Wall  - 1.60 Litre - $75.00
Coats: 2
1.75
Total
Painting: 1.75
=
1.75
Cleaning
hr
Cleaning
2
Total
Painting: 2
=
2
Fall protection
hr
Fall protection
15.75
Total
Painting: 15.75
=
15.75
Media
`;

describe("pricedBlocksOf", () => {
  it("reads the Zap job's blocks back as priced areas, headings and lines, in order", () => {
    const { existing } = zapped();
    expect(pricedBlocksOf(existing.builderState)).toEqual([
      { name: "Exterior Preparation", priceCents: 0, kind: "heading" },
      { name: "Front Side", priceCents: 120000, kind: "line" },
      { name: "Front Side", priceCents: 30000, kind: "line" },
      { name: "Living Area Wall x 1", priceCents: 25000, kind: "line" },
      { name: "Cleaning", priceCents: 15000, kind: "line" },
      { name: "Scaffolding", priceCents: 110000, kind: "line" },
    ]);
  });
  it("is empty for a scope it cannot read", () => {
    expect(pricedBlocksOf(null)).toEqual([]);
    expect(pricedBlocksOf({ blocks: "no" })).toEqual([]);
  });
});

describe("jobFromWorkOrder", () => {
  const { existing } = zapped();
  const wo = parseWorkOrderText(WO_TEXT);
  const r = jobFromWorkOrder(existing, wo, { workOrderUrl: "https://example.com/w" });

  it("gives each work-order area the price of its first unconsumed twin on the quote, repeated names in order", () => {
    const byName = r.job.areas.map((a) => [a.name, a.price_ex_gst_cents, a.items.length, a.hours_total]);
    expect(byName).toEqual([
      ["Exterior Preparation", 0, 0, null],
      ["Front Side", 120000, 2, 10],
      ["Front Side", 30000, 1, 2],
      ["Living Area Wall x 1", 25000, 1, 1.75],
      ["Cleaning", 15000, 0, 2],
      ["Fall protection", null, 0, 15.75],
      ["Scaffolding", 110000, 0, null],
    ]);
  });

  it("says what it could not match, both ways, and keeps the quote's money", () => {
    expect(r.warnings.some((w) => w.startsWith('"Fall protection" carries 15.75 h'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('"Scaffolding" is priced on the quote'))).toBe(true);
    expect(r.hoursDisagree).toBe(false);
    expect(r.job.total_hours).toBe(31.5);
    expect(r.job.materials).toEqual([{ product: "Dulux Weathershield", litres: 38 }]);
  });

  it("carries the estimate's own facts, not the page's", () => {
    expect(r.job).toMatchObject({
      quote_no: "9613", customer_name: "Casey Example", email: "casey@example.com", suburb: "Testville",
      subtotal_ex_gst_cents: 300000, total_inc_gst_cents: 330000, gst_cents: 30000, job_type_norm: "exterior",
      contractor_offer_cents: 150000, start_date: "2026-10-05", end_date: "2026-10-07", number_of_workers: 2,
      work_order_url: "https://example.com/w", date_accepted_ms: Date.parse("2026-09-10T03:00:00.000Z"),
    });
  });

  it("the build proves the signed total to the cent over the joined scope, with the hours and products on the sheet", () => {
    const built = buildBookedJob(r.job, new SubstrateResolver([], [{ paintscout_item: "Doors", side: "exterior", platform_rate_code: "Standard Door (1 Side)" }]), ctxFor(["Standard Door (1 Side)"]), COMPANY, "tokentokentokentokentoken");
    expect(built.totals).toMatchObject({ subtotalCents: 300000, totalCents: 330000, hours: 31.5 });
    expect(built.externalRef.hours_pending).toBe(false);
    const sheet = built.woDoc;
    expect(sheet.areas.map((a) => a.title)).toEqual(["Front Side", "Front Side", "Living Area Wall x 1", "Cleaning", "Fall protection"]);
    expect(sheet.areas[0].surfaces.map((s) => [s.label, s.hours, s.coats, s.product])).toEqual([
      ["Soffits / Eaves", 4, 2, "Dulux Weathershield"], ["Doors", 6, 2, "Dulux Weathershield"],
    ]);
    expect(sheet.materials).toEqual([{ product: "Dulux Weathershield", colourKey: "Dulux Weathershield", photoUrl: "", litres: 38, coverageMissing: false, colourName: "", colourHex: "", colourStatus: "tbc" }]);
    // The scaffolding keeps its $1,100 as a line the sheet does not tick.
    const lines = built.builderState.blocks.filter((b) => b.kind === "line");
    expect(lines.map((l) => [l.name, l.custom, l.hidden])).toEqual([["Exterior Preparation", 0, true], ["Scaffolding", 1100, false]]);
    expect(lines[1]).toMatchObject({ subcontractorExpense: true });
  });

  it("flags a page whose banner disagrees with its lines", () => {
    const off = jobFromWorkOrder(existing, parseWorkOrderText(WO_TEXT.replace("Total Hours\n31.5", "Total Hours\n40")));
    expect(off.hoursDisagree).toBe(true);
    expect(off.warnings.some((w) => w.includes("the page says 40 h"))).toBe(true);
  });
});
