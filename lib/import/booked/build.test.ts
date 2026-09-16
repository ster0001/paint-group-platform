import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBookedJob, CUSTOM_SURFACE_CODE, dateSpan, splitPriceByHours, SubstrateResolver, trayNoteFor, type CompanyLetterhead } from "./build";
import { parseBookedJobs, substrateMapRowSchema, type BookedJob, type SubstrateMapRow } from "./types";
import type { PricingContext } from "@/lib/pricing/estimate";
import { parseCsv } from "@/lib/import/csv";

/**
 * The pack itself (docs/imports/airtable-crm-import/booked/) holds real
 * customers and is NOT committed — it lives on Tom's Mac. When it is there,
 * every one of the 35 jobs is built and proved to the cent; when it is not
 * (CI), the synthetic job below stands in and pins the same rules.
 */
const PACK = resolve(process.cwd(), "docs/imports/airtable-crm-import/booked");
const hasPack = existsSync(resolve(PACK, "booked_jobs.json"));

const COMPANY: CompanyLetterhead = {
  name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "",
  estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "",
};

/** A pricing context with one row per code on each side — the overrides
 *  bypass every rate, so the values only need to exist. */
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

const SYNTHETIC: BookedJob = {
  quote_no: "9001", view: "booked", airtable_status: "Job Booked", project_name: "2 Example Crescent stage 3",
  customer_name: "Melissa Example", email: "pg.e2e.booked@example.com", phone: "0491570156", account_key: "acc_test",
  address: "2 Example Crescent", suburb: "Testville", postcode: "3000", paintscout_address: "", job_type: "Interior", job_type_norm: "interior",
  level_of_finish: 3, level_of_finish_assumed: "", quote_url: "https://example.com/q", work_order_url: "https://example.com/w",
  subtotal_ex_gst_cents: 184800, gst_cents: 18480, total_inc_gst_cents: 203280, discount_ex_gst_cents: 0, discount_label: "",
  options_accepted_ex_gst_cents: 0, total_hours: 17.5, contractor_offer_cents: 96000, start_date: "2026-09-29", end_date: "2026-09-30",
  number_of_workers: 1, assigned_painter: "", assigned_painter_email: "", painter_accepted: "", date_accepted_ms: 1757900000000,
  deposit_recorded: "no", notes: "", import_note: "",
  areas: [
    { name: "Interior Preparation", price_ex_gst_cents: 19000, hours_prep: null, hours_paint: 2, hours_total: 2, length_m: null, width_m: null, height_m: null, items: [] },
    { name: "Interior and Exterior Paintwork", price_ex_gst_cents: null, hours_prep: null, hours_paint: null, hours_total: null, length_m: null, width_m: null, height_m: null, items: [] },
    { name: "Kitchen", price_ex_gst_cents: 151550, hours_prep: 2.5, hours_paint: 11.5, hours_total: 14, length_m: 4, width_m: 3, height_m: 2.4, items: [
      { item: "Ceiling", qty: 24, unit: "m2", coats: 2, hours: 3 },
      { item: "Cornices", qty: 20, unit: "m", coats: 2, hours: 1.5 },
      { item: "Walls", qty: 16, unit: "m2", coats: 2, hours: 4 },
      { item: "Skirting Boards", qty: 20, unit: "m", coats: 2, hours: 4.25 },
      { item: "Window Reveal", qty: 1, unit: "count", coats: 2, hours: 1.25 },
    ] },
    { name: "Cleaning", price_ex_gst_cents: 14250, hours_prep: null, hours_paint: 1.5, hours_total: 1.5, length_m: null, width_m: null, height_m: null, items: [] },
  ],
};
const SYNTHETIC_MAP: SubstrateMapRow[] = [
  { quote_no: "9001", area: "Kitchen", item: "Ceiling", unit: "m2", qty: "24", coats: "2", hours: "3", side: "interior", rate_code: "Ceilings", match: "exact", internal_label: "Ceiling", client_label: "Ceiling" },
  { quote_no: "9001", area: "Kitchen", item: "Cornices", unit: "m", qty: "20", coats: "2", hours: "1.5", side: "interior", rate_code: "Standard Cornices", match: "exact", internal_label: "Cornices", client_label: "Cornices" },
  { quote_no: "9001", area: "Kitchen", item: "Walls", unit: "m2", qty: "16", coats: "2", hours: "4", side: "interior", rate_code: "Walls", match: "exact", internal_label: "Walls", client_label: "Walls" },
  { quote_no: "9001", area: "Kitchen", item: "Skirting Boards", unit: "m", qty: "20", coats: "2", hours: "4.25", side: "interior", rate_code: "Skirting Boards", match: "exact", internal_label: "Skirting Boards", client_label: "Skirting Boards" },
  { quote_no: "9001", area: "Kitchen", item: "Window Reveal", unit: "count", qty: "1", coats: "2", hours: "1.25", side: "interior", rate_code: "", match: "custom", internal_label: "Window Reveal", client_label: "Window Reveal" },
];

describe("pro-rata split", () => {
  it("sums to the area price exactly, remainder on the last line", () => {
    expect(splitPriceByHours(151550, [3, 1.5, 4, 4.25, 1.25])).toEqual([32475, 16238, 43300, 46006, 13531]);
    expect(splitPriceByHours(151550, [3, 1.5, 4, 4.25, 1.25]).reduce((a, b) => a + b, 0)).toBe(151550);
    expect(splitPriceByHours(100, [0, 0, 0])).toEqual([33, 33, 34]);
    expect(splitPriceByHours(1, [2, 2])).toEqual([1, 0]);
    expect(splitPriceByHours(0, [])).toEqual([]);
  });
});

describe("tray note", () => {
  it("says what Airtable had planned (B0.3)", () => {
    expect(dateSpan("2026-11-16", "2026-11-20")).toBe("16–20 Nov 2026");
    expect(dateSpan("2026-09-28", "2026-11-14")).toBe("28 Sep 2026 – 14 Nov 2026");
    expect(trayNoteFor(SYNTHETIC)).toBe("Airtable: booked 29–30 Sep 2026, no painter assigned.");
    expect(trayNoteFor({ ...SYNTHETIC, assigned_painter: "Jacob", assigned_painter_email: "admin@djdecor.com.au", painter_accepted: "Accepted", start_date: "2026-11-16", end_date: "2026-11-20" }))
      .toBe("Airtable: booked 16–20 Nov 2026 with Jacob (admin@djdecor.com.au) — painter accepted. Send the offer.");
    expect(trayNoteFor({ ...SYNTHETIC, view: "needs", start_date: "", end_date: "" })).toBe("Airtable: needs booking.");
  });
});

describe("one signed job → working scope + documents", () => {
  const CODES = ["Ceilings", "Standard Cornices", "Walls", "Skirting Boards"];
  const built = buildBookedJob(SYNTHETIC, new SubstrateResolver(SYNTHETIC_MAP), ctxFor(CODES), COMPANY, "abcdefgh12345678901234567890");

  it("the engine's total over the built state is PaintScout's, to the cent, with the uplift off and no sundries", () => {
    expect(built.totals).toMatchObject({ subtotalCents: 184800, gstCents: 18480, totalCents: 203280, hours: 17.5 });
    expect(built.builderState.sizeUpliftDisabled).toBe(true);
    expect(built.builderState.preparationOverrideCents).toBe(0);
  });

  it("Kitchen keeps every PaintScout line with its quantity, coats and hours; prep is a note, not extra hours (B0.4)", () => {
    const kitchen = built.builderState.blocks.find((b) => b.kind === "area" && b.name === "Kitchen");
    expect(kitchen?.kind).toBe("area");
    if (kitchen?.kind !== "area") return;
    expect(kitchen.surfaces.map((s) => [s.internalLabel, s.qtyOverride, s.coats, s.paintingHrOverride, s.prepHr, s.code])).toEqual([
      ["Ceiling", 24, 2, 3, 0, "Ceilings"], ["Cornices", 20, 2, 1.5, 0, "Standard Cornices"], ["Walls", 16, 2, 4, 0, "Walls"],
      ["Skirting Boards", 20, 2, 4.25, 0, "Skirting Boards"], ["Window Reveal", 1, 2, 1.25, 0, CUSTOM_SURFACE_CODE],
    ]);
    expect(kitchen.surfaces.reduce((n, s) => n + Math.round(s.priceOverride * 100), 0)).toBe(151550);
    expect(kitchen.description).toContain("Preparation 2.5 h");
    expect(kitchen).toMatchObject({ L: 4, W: 3, H: 2.4, type: "Interior" });
  });

  it("hours-only areas become crew work on the job sheet; a heading is a hidden $0 line", () => {
    const names = built.builderState.blocks.map((b) => [b.kind, b.name, b.kind === "line" ? b.hidden : false]);
    expect(names).toEqual([["area", "Interior Preparation", false], ["line", "Interior and Exterior Paintwork", true], ["area", "Kitchen", false], ["area", "Cleaning", false]]);
    expect(built.woDoc.areas.map((a) => [a.title, a.surfaces.reduce((n, s) => n + (s.hours ?? 0), 0)])).toEqual([["Interior Preparation", 2], ["Kitchen", 14], ["Cleaning", 1.5]]);
    expect(built.sentSnapshot.areas.map((a) => [a.title, a.priceCents])).toEqual([["Interior Preparation", 19000], ["Kitchen", 151550], ["Cleaning", 14250]]);
    expect(built.sentSnapshot.lineItems).toEqual([]);
    expect(built.sentSnapshot.baseSubtotalCents).toBe(184800);
    expect(built.sentSnapshot.estRef).toBe("ABCDEFGH");
    expect(built.counts).toEqual({ areas: 4, lines: 5, customLines: 3 });
  });

  it("the job sheet is contractor-safe and lands in the tray shape", () => {
    expect(built.woDoc).toMatchObject({ woRef: "PS-9001", status: "issued", startDate: null, contactFirstName: "Melissa", finishCode: "PG-3", contractorPaymentCents: 96000, idealPainters: 1, materials: [] });
    expect(JSON.stringify(built.woDoc)).not.toContain("example.com");
    expect(JSON.stringify(built.woDoc)).not.toContain("203280");
    expect(built.trayNote).toBe("Airtable: booked 29–30 Sep 2026, no painter assigned.");
  });

  it("refuses a job whose figures do not add up", () => {
    expect(() => buildBookedJob({ ...SYNTHETIC, total_inc_gst_cents: 203281 }, new SubstrateResolver(SYNTHETIC_MAP), ctxFor(CODES), COMPANY, "t")).toThrow(/refusing to write/);
    expect(() => buildBookedJob({ ...SYNTHETIC, total_hours: 18 }, new SubstrateResolver(SYNTHETIC_MAP), ctxFor(CODES), COMPANY, "t")).toThrow(/hours/);
    // A code the active card does not carry prices at nothing — the engine ignores the override — so the build must refuse rather than write a short total.
    expect(() => buildBookedJob(SYNTHETIC, new SubstrateResolver(SYNTHETIC_MAP), ctxFor(["Walls"]), COMPANY, "t")).toThrow(/rate card/);
  });

  it("a discount is one negative line labelled as PaintScout labelled it", () => {
    const withDiscount = buildBookedJob(
      { ...SYNTHETIC, discount_ex_gst_cents: -23304, discount_label: "Custom...", subtotal_ex_gst_cents: 161496, gst_cents: 16150, total_inc_gst_cents: 177646 },
      new SubstrateResolver(SYNTHETIC_MAP), ctxFor(CODES), COMPANY, "t",
    );
    const line = withDiscount.builderState.blocks.at(-1);
    expect(line).toMatchObject({ kind: "line", name: "Custom...", custom: -233.04 });
    expect(withDiscount.sentSnapshot.lineItems).toEqual([{ id: String(line!.id), title: "Custom...", descriptionHtml: "", priceCents: -23304 }]);
  });
});

describe.skipIf(!hasPack)("the real pack: all 35 signed jobs", () => {
  const jobs = hasPack ? parseBookedJobs(JSON.parse(readFileSync(resolve(PACK, "booked_jobs.json"), "utf8"))) : [];
  const lineMap = hasPack ? parseCsv(readFileSync(resolve(PACK, "booked_substrate_map.csv"), "utf8")).map((r) => substrateMapRowSchema.parse(r)) : [];
  const expected = hasPack ? parseCsv(readFileSync(resolve(PACK, "booked_estimates.csv"), "utf8")) : [];
  const codes = new Set(lineMap.map((r) => r.rate_code).filter(Boolean));

  it("every job builds and prices to the cent; 342 areas, 827 lines, 2,785.8 h, $341,578.52", () => {
    const resolver = new SubstrateResolver(lineMap);
    let total = 0; let hours = 0; let areas = 0; let lines = 0; let custom = 0;
    for (const job of jobs) {
      const built = buildBookedJob(job, resolver, ctxFor(codes), COMPANY, "token123");
      const row = expected.find((r) => r.quote_no === job.quote_no)!;
      expect(built.totals.totalCents, job.quote_no).toBe(Number(row.total_inc_gst_cents));
      expect(built.totals.subtotalCents, job.quote_no).toBe(Number(row.subtotal_ex_gst_cents));
      total += built.totals.totalCents; hours += built.totals.hours; areas += built.counts.areas; lines += built.counts.lines; custom += built.counts.customLines;
      // Every area's surfaces sum to the area's PaintScout price — blocks are in
      // the pack's order (a discount line, when there is one, comes last).
      job.areas.forEach((src, i) => {
        const b = built.builderState.blocks[i];
        expect(b.name).toBe(src.name);
        if (b.kind === "area") {
          expect(b.surfaces.reduce((n, s) => n + Math.round(s.priceOverride * 100), 0), `${job.quote_no} ${src.name}`).toBe(src.price_ex_gst_cents ?? 0);
        } else {
          expect(Math.round(b.custom * 100)).toBe(src.price_ex_gst_cents ?? 0);
        }
      });
    }
    expect(resolver.unconsumed()).toBe(0);
    expect(total).toBe(34157852);
    expect(Math.round(hours * 100) / 100).toBe(2785.8);
    expect(areas).toBe(342);
    expect(lines).toBe(827);
    // 41 custom lines plus the hours-only areas (Interior Preparation, Cleaning…) that ride the custom row.
    expect(custom).toBeGreaterThanOrEqual(41);
  });

  it("3623, 3672, 2826 as the brief describes them", () => {
    const resolver = new SubstrateResolver(lineMap);
    const by = (q: string) => buildBookedJob(jobs.find((j) => j.quote_no === q)!, resolver, ctxFor(codes), COMPANY, "token123");
    const j3623 = by("3623");
    expect(j3623.totals).toMatchObject({ totalCents: 203280, hours: 17.5 });
    expect(j3623.trayNote).toBe("Airtable: booked 29–30 Sep 2026, no painter assigned.");
    const kitchen = j3623.builderState.blocks.find((b) => b.kind === "area" && b.name === "Kitchen");
    expect(kitchen?.kind === "area" && kitchen.surfaces.map((s) => [s.internalLabel, s.qtyOverride, s.paintingHrOverride])).toEqual([["Ceiling", 24, 3], ["Cornices", 20, 1.5], ["Walls", 16, 4], ["Skirting Boards", 20, 4.25], ["Window Reveal", 1, 1.25]]);
    const j3672 = by("3672");
    expect(j3672.totals).toMatchObject({ totalCents: 1650000, hours: 153.85 });
    expect(j3672.counts.areas).toBe(21);
    expect(j3672.builderState.blocks.filter((b) => b.name === "Bedroom 3")).toHaveLength(2);
    expect(j3672.builderState.blocks.at(-1)).toMatchObject({ kind: "line", name: "Custom...", custom: -233.04 });
    const j2826 = by("2826");
    expect(j2826.trayNote).toBe("Airtable: booked 16–20 Nov 2026 with Jacob (admin@djdecor.com.au) — painter accepted. Send the offer.");
    expect(j2826.totals.hours).toBe(64.5);
  });
});
