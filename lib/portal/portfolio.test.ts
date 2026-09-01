import { describe, expect, it } from "vitest";
import { buildPortfolio, type PortfolioVariation } from "./portfolio";
import type { PortalEstimate, PortalWorkOrder } from "./home";
import type { MoneyInvoice } from "./money";

const TODAY = "2026-08-27";

const est = (over: Partial<PortalEstimate>): PortalEstimate => ({
  id: over.id ?? "e1", title: "8/22 Clarke St, Northcote", status: "accepted", source: null,
  total_cents: null, share_token: null, sent_at: null, created_at: "2026-08-01T00:00:00Z", ...over,
});
const wo = (over: Partial<PortalWorkOrder>): PortalWorkOrder =>
  ({ estimate_id: "e1", stage: "in_progress", start_date: "2026-08-26", end_date: "2026-08-29", ...over });
const inv = (over: Partial<MoneyInvoice>): MoneyInvoice => ({
  id: over.id ?? "i1", estimate_id: "e1", kind: "deposit", status: "issued", number: "INV-1",
  token: "t1", issued_on: "2026-08-13", due_on: "2027-01-01", total_inc_cents: 100_000, gst_cents: 9_091, ...over,
});
const vn = (over: Partial<PortfolioVariation>): PortfolioVariation => ({
  id: over.id ?? "v1", estimate_id: "e1", status: "priced", price_cents: 34_000,
  customer_token: "vt1", customer_responded_at: null, ...over,
});

describe("buildPortfolio — the trade workspace aggregates, never invents", () => {
  it("tiles: underway, waiting-on-you, drafts, invoiced-this-month", () => {
    const { tiles } = buildPortfolio({
      estimates: [est({}), est({ id: "e2", status: "draft", title: "14 Herbert St" })],
      workOrders: [wo({})],
      invoices: [
        inv({}), // issued this month → counts
        inv({ id: "i2", issued_on: "2026-07-30", number: "INV-2", token: "t2" }), // last month
        inv({ id: "i3", status: "draft", number: null, token: "t3" }), // drafts never count
      ],
      payments: [],
      variations: [vn({})],
      todayYmd: TODAY,
    });
    expect(tiles.underway).toBe(1);
    expect(tiles.drafts).toBe(1);
    expect(tiles.invoicedThisMonthCents).toBe(100_000);
    expect(tiles.waitingOnYou).toBeGreaterThanOrEqual(1);
  });

  it("a priced variation leads the attention queue with the /v deep link", () => {
    const { attention } = buildPortfolio({
      estimates: [est({})], workOrders: [], invoices: [], payments: [],
      variations: [vn({}), vn({ id: "v2", customer_responded_at: "2026-08-20T00:00:00Z" })],
      todayYmd: TODAY,
    });
    expect(attention).toHaveLength(1);
    expect(attention[0].cta).toEqual({ label: "Review & approve", href: "/v/vt1" });
    expect(attention[0].amountCents).toBe(34_000);
  });

  it("walkthrough stage asks for the walkthrough; sent estimates ask for a decision", () => {
    const { attention } = buildPortfolio({
      estimates: [est({}), est({ id: "e2", status: "sent", share_token: "tok2", total_cents: 412_000, title: "3/117 High St" })],
      workOrders: [wo({ stage: "walkthrough" })],
      invoices: [], payments: [], variations: [], todayYmd: TODAY,
    });
    expect(attention.map((a) => a.key)).toEqual(["walkthrough:e1", "estimate:e2"]);
    expect(attention[1].meta).toContain("$4,120.00");
  });

  it("an overdue invoice surfaces with its balance and pay link", () => {
    const { attention } = buildPortfolio({
      estimates: [est({})], workOrders: [],
      invoices: [inv({ due_on: "2026-08-20" })],
      payments: [{ id: "p1", invoice_id: "i1", amount_cents: 40_000, status: "succeeded", paid_on: "2026-08-21", receipt_number: null }],
      variations: [], todayYmd: TODAY,
    });
    expect(attention).toHaveLength(1);
    expect(attention[0].amountCents).toBe(60_000);
    expect(attention[0].cta.href).toBe("/i/t1?portal=1");
  });

  it("jobs underway carry customer-word chips and a day-based bar", () => {
    const { underway } = buildPortfolio({
      estimates: [est({}), est({ id: "e2", title: "45 Union Rd", status: "accepted" })],
      workOrders: [wo({}), wo({ estimate_id: "e2", stage: "walkthrough" })],
      invoices: [], payments: [], variations: [], todayYmd: TODAY,
    });
    expect(underway[0].chip.label).toBe("Day 2 of 4");
    expect(underway[0].progressPct).toBe(50);
    expect(underway[1].chip.label).toBe("Sign-off");
  });
});
