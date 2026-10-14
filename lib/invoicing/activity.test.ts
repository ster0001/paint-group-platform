/** §6.7: Activity repeated "Invoice viewed by customer" once per view — one line with a count. */
import { describe, expect, it } from "vitest";
import { activityFeed, type ActivityEvent } from "./activity";

const ev = (id: string, invoiceId: string, type: string, createdAt: string, meta: Record<string, unknown> = {}): ActivityEvent => ({ id, invoiceId, type, meta, createdAt });
const invoices = [
  { id: "a", number: "INV-0049", kind: "final", estimateId: "brolga" },
  { id: "b", number: null, kind: "deposit", estimateId: "kite" },
];

describe("activity feed (§6.7)", () => {
  // Newest first, as the loader reads them.
  const lines = activityFeed([
    ev("6", "a", "viewed", "2026-10-12T09:00:00Z"),
    ev("5", "a", "payment_received", "2026-10-11T09:00:00Z", { amount_cents: 450_000, method: "bank_transfer" }),
    ev("4", "a", "viewed", "2026-10-10T09:00:00Z"),
    ev("3", "a", "viewed", "2026-10-09T09:00:00Z"),
    ev("2", "b", "drafted", "2026-10-08T09:00:00Z", { auto: "acceptance", deposit_pct: 50, total_inc_cents: 211_169 }),
    ev("1", "a", "sent", "2026-10-07T09:00:00Z"),
  ], invoices);

  it("views of one invoice fold into one line, at its newest view, with a count", () => {
    const viewed = lines.filter((l) => l.type === "viewed");
    expect(viewed).toHaveLength(1);
    expect(viewed[0]).toMatchObject({ title: "Invoice viewed by customer, 3 times", count: 3, at: "2026-10-12T09:00:00Z", firstAt: "2026-10-09T09:00:00Z" });
  });
  it("everything else keeps its own line, newest first, with its amount in cents", () => {
    expect(lines.map((l) => l.type)).toEqual(["viewed", "payment_received", "drafted", "sent"]);
    expect(lines[1]).toMatchObject({ title: "Payment received", amountCents: 450_000, detail: "bank transfer", invoiceLabel: "INV-0049", estimateId: "brolga" });
    expect(lines[2]).toMatchObject({ title: "Deposit drafted on acceptance", detail: "50%", invoiceLabel: "Deposit draft" });
  });
  it("a single view reads plainly", () => {
    expect(activityFeed([ev("1", "a", "viewed", "2026-10-12T09:00:00Z")], invoices)[0].title).toBe("Invoice viewed by customer");
  });
});
