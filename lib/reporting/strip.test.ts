/**
 * Session 1 — the needs-doing strip picks from the evaluators that exist;
 * it builds no list of its own. Per role: finance gets money, sales gets
 * follow-ups, PC gets the console's cards, everyone gets customer messages,
 * the owner gets all — critical first.
 */
import { describe, expect, it } from "vitest";
import type { WorkItem } from "@/lib/crm/work-queue";
import type { QueueCard } from "@/lib/workorder/console";
import { buildStrip, type StripCard } from "./strip";

const item = (kind: WorkItem["kind"], bucket: WorkItem["bucket"], title: string): WorkItem => ({
  key: `k:${kind}:${title}`, kind, accountId: "a1", subjectRef: { type: "account", id: "a1" }, title, detail: "d", since: "2026-09-19T00:00:00Z",
  dueAt: null, bucket, priority: 1, action: { label: "Open", href: `/crm/${kind}` },
} as unknown as WorkItem);

const card = (severity: QueueCard["severity"], title: string): QueueCard => ({
  key: `c:${title}`, severity, title, detail: "d", ref: "#3169", workOrderId: "w1", ageHours: 27, action: { label: "Re-offer", kind: "reoffer" },
});

const input = {
  workItems: [
    item("invoice_action", "overdue", "$4,200 deposit unpaid"),
    item("followup_due", "today", "4 estimates expire within 14 days"),
    item("message_unanswered", "today", "Mark Ellis waiting"),
    item("approval_pending", "today", "Approve a campaign"),
  ],
  consoleCards: [card("critical", "Offer to Felipe past 24h SLA"), card("info", "Photos thin")],
};

describe("buildStrip", () => {
  it("finance: money and customer messages, not follow-ups or jobs", () => {
    expect(buildStrip(input, ["finance"]).map((c) => c.title)).toEqual(["$4,200 deposit unpaid", "Mark Ellis waiting"]);
  });
  it("sales: follow-ups and customer messages", () => {
    expect(buildStrip(input, ["sales"]).map((c) => c.title)).toEqual(["4 estimates expire within 14 days", "Mark Ellis waiting"]);
  });
  it("pc: the console's cards and customer messages, critical first", () => {
    expect(buildStrip(input, ["pc"]).map((c) => c.title)).toEqual(["Offer to Felipe past 24h SLA", "Mark Ellis waiting", "Photos thin"]);
    expect(buildStrip(input, ["pc"])[0]).toMatchObject({ severity: "critical", label: "Critical · job", action: { href: "/pc/wo/w1" } });
  });
  it("owner: everything the three sources hold, and approvals stay on Today", () => {
    const titles = buildStrip(input, ["owner"]).map((c) => c.title);
    expect(titles).toEqual(["$4,200 deposit unpaid", "Offer to Felipe past 24h SLA", "4 estimates expire within 14 days", "Mark Ellis waiting", "Photos thin"]);
    expect(titles).not.toContain("Approve a campaign");
  });
  it("no roles, no cards; the limit holds", () => {
    expect(buildStrip(input, [])).toEqual([]);
    expect(buildStrip(input, ["owner"], 2)).toHaveLength(2);
  });
});

describe("session 5 — trend cards are never crowded out", () => {
  it("keeps every extra card past the limit and fills the rest with the highest-ranked cards", () => {
    const items = Array.from({ length: 20 }, (_, n) => ({
      key: `inv-${n}`, kind: "invoice_action", bucket: "overdue", title: `Invoice ${String(n).padStart(2, "0")}`, detail: "", action: { label: "Open", href: "/invoicing" },
    })) as unknown as WorkItem[];
    const extra: StripCard[] = [{ key: "anomaly:pl.contracts_signed_ex", severity: "amber", label: "Amber · trend", title: "Contracts signed up 40% vs August", detail: "", action: { label: "See the tile", href: "/home#section-pl" }, roles: ["owner", "admin"] }];
    const strip = buildStrip({ workItems: items, consoleCards: [], extra }, ["owner"]);
    expect(strip).toHaveLength(12);
    expect(strip.some((c) => c.key === "anomaly:pl.contracts_signed_ex")).toBe(true);
    expect(strip.filter((c) => c.severity === "critical")).toHaveLength(11);
    // Not for a finance login: the trend card is owner/admin.
    expect(buildStrip({ workItems: items, consoleCards: [], extra }, ["finance"]).some((c) => c.key.startsWith("anomaly:"))).toBe(false);
  });
});
