import { test, expect } from "vitest";
import {
  buildTradePortfolio,
  defaultReferenceLabels,
  swatchStrip,
  type TPColourSwatch,
} from "./tradePortfolio";

const TODAY = "2026-08-31";

const base = () => ({
  properties: [{ id: "p1", address: "14 Beaumont St", suburb: "Elwood" }],
  references: [],
  colours: [] as TPColourSwatch[],
  estimates: [],
  workOrders: [],
  surfaceCounts: [],
  invoices: [],
  payments: [],
  variations: [],
  todayYmd: TODAY,
});

const est = (over: Record<string, unknown>) => ({
  id: "e1", title: "Interior repaint", status: "accepted", total_cents: 484000,
  share_token: null, property_id: "p1", sent_at: null, created_at: "2026-08-28T00:00:00Z",
  ...over,
});

test("swatch strip: current records only, walls→ceilings→trims→doors, repeats collapse, capped at 6", () => {
  const colours: TPColourSwatch[] = [
    { property_id: "p", surface_type: "door", swatch_hex: "#2a2e33", status: "applied" },
    { property_id: "p", surface_type: "wall", swatch_hex: "#f1ede4", status: "applied" },
    { property_id: "p", surface_type: "trim", swatch_hex: "#ffffff", status: "planned" },
    { property_id: "p", surface_type: "ceiling", swatch_hex: "#ffffff", status: "applied" },
    { property_id: "p", surface_type: "wall", swatch_hex: "#f1ede4", status: "superseded" }, // history: not shown
    { property_id: "p", surface_type: "wall", swatch_hex: null, status: "applied" }, // no hex → neutral
  ];
  // walls (#f1ede4, then neutral ""), ceiling #ffffff, trim #ffffff collapses, door.
  expect(swatchStrip(colours)).toEqual(["#f1ede4", "", "#ffffff", "#2a2e33"]);
});

test("pulse tiles + chip precedence: awaiting-you beats on-site; each key filters", () => {
  const out = buildTradePortfolio({
    ...base(),
    properties: [
      { id: "p1", address: "14 Beaumont St", suburb: "Elwood" },
      { id: "p2", address: "22 Ormond Rd", suburb: "Elwood" },
    ],
    estimates: [
      est({ id: "e1", property_id: "p1", status: "sent", share_token: "tok1", sent_at: "2026-08-28T00:00:00Z" }),
      est({ id: "e2", property_id: "p2", status: "accepted" }),
    ],
    workOrders: [
      { id: "w1", estimate_id: "e1", wo_ref: "PG-3181", stage: "in_progress", start_date: "2026-08-30", end_date: "2026-09-02" },
      { id: "w2", estimate_id: "e2", wo_ref: "PG-3176", stage: "in_progress", start_date: "2026-08-30", end_date: "2026-09-02" },
    ],
    surfaceCounts: [{ work_order_id: "w2", done: 11, total: 24 }],
  });
  expect(out.pulse).toEqual({ onSite: 2, needApproval: 1, readyToSignOff: 0, overdue: 0 });
  const p1 = out.cards.find((c) => c.id === "p1")!;
  expect(p1.chip.label).toBe("Awaiting you"); // approval outranks on-site
  expect(p1.pulseKeys.sort()).toEqual(["approval", "onsite"]);
  const p2 = out.cards.find((c) => c.id === "p2")!;
  expect(p2.chip.label).toMatch(/^On site · day 2 of/i);
  expect(p2.progressPct).toBe(Math.round((11 / 24) * 100));
  expect(p2.summary).toBe("Work under way · 11 of 24 surfaces done");
  // Needs-you first in the sort.
  expect(out.cards[0].id).toBe("p1");
});

test("reference line prints stored labels + job number; haystack finds by reference value", () => {
  const out = buildTradePortfolio({
    ...base(),
    references: [{ property_id: "p1", label: "Owner", value: "T. & M. Nguyen", sort: 0 }],
    estimates: [est({ id: "e1", status: "accepted" })],
    workOrders: [{ id: "w1", estimate_id: "e1", wo_ref: "PG-3181", stage: "closed", start_date: null, end_date: null }],
  });
  const card = out.cards[0];
  expect(card.refLine).toBe("Owner · T. & M. Nguyen  ·  Job PG-3181");
  expect(card.haystack).toContain("nguyen");
  expect(card.haystack).toContain("pg-3181");
  expect(card.chip.label).toBe("Complete");
});

test("no work anywhere → the quiet card", () => {
  const out = buildTradePortfolio(base());
  expect(out.cards[0].chip.label).toBe("No active work");
  expect(out.cards[0].summary).toMatch(/touch-up or new estimate/);
  expect(out.cards[0].progressPct).toBeNull();
});

test("overdue invoice raises the clay chip and the overdue tile", () => {
  const out = buildTradePortfolio({
    ...base(),
    estimates: [est({ id: "e1" })],
    invoices: [{
      id: "i1", estimate_id: "e1", kind: "final", status: "issued", number: "PG-3172",
      total_inc_cents: 231000, due_on: "2026-08-21", issued_on: "2026-08-07",
      token: "invtok", paid_on: null,
    } as never],
  });
  expect(out.pulse.overdue).toBe(1);
  expect(out.cards[0].chip).toEqual({ cls: "clay", label: "Invoice overdue" });
  const overdueItem = out.attention.find((a) => a.key === "invoice:i1")!;
  expect(overdueItem.cta.href).toBe("/i/invtok?portal=1");
});

test("attention leads with the PROPERTY address, not the estimate title", () => {
  const out = buildTradePortfolio({
    ...base(),
    estimates: [est({ id: "e1", status: "sent", share_token: "tok", title: "Interior repaint between tenancies" })],
  });
  expect(out.attention[0].address).toBe("14 Beaumont St, Elwood");
});

test("defaultReferenceLabels follow org_kind", () => {
  expect(defaultReferenceLabels("real_estate")).toEqual(["Owner", "Your ref"]);
  expect(defaultReferenceLabels("facilities")).toEqual(["Site", "PO"]);
  expect(defaultReferenceLabels("insurance")).toEqual(["Claim", "Assessor"]);
  expect(defaultReferenceLabels(null)).toEqual(["Your ref"]);
});
