import { describe, expect, it } from "vitest";
import { computeFactsRow } from "./facts";
import type { CustomerInput } from "./factsInput";

const NOW = new Date("2026-09-07T10:00:00+10:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const input = (over: Partial<CustomerInput> = {}): CustomerInput => ({
  accountId: "a1",
  name: "Garry Kennedy",
  meta: "Richmond · residential",
  valueCents: 435_200,
  source: null,
  note: null,
  phone: "0412 345 678",
  draft: null,
  trade: false,
  email: "garry@example.com",
  ownerId: null,
  address: "116 Coppin Street Richmond VIC 3121",
  suburb: "Richmond",
  accountType: "residential",
  allEvents: [],
  relationshipState: "active", stateUntil: null, stateNote: null, permitEmail: "unknown", permitSms: "unknown", permitPhone: "unknown", tags: [], lostReason: null, jobTypes: [],
  facts: { estimates: [], workOrders: [], events: [], temperature: null, snoozedUntil: null, followupDueAt: null },
  ...over,
});

const est = (over: Partial<CustomerInput["facts"]["estimates"][number]> = {}) => ({
  id: "e1", status: "sent", total_cents: 435_200, created_at: daysAgo(5), sent_at: daysAgo(4),
  viewed_at: null, accepted_at: null, declined_at: null, ...over,
});

describe("computeFactsRow — the card, cached, plus the keys the list sorts on", () => {
  it("stores exactly what cardFor says, and searches on everything a person might type", () => {
    const row = computeFactsRow(input({ facts: { ...input().facts, estimates: [est()] } }), NOW);
    expect(row.stage).toBe("estimate_sent");
    expect(row.because).toBe("Not opened · 4d");
    expect(row.search).toContain("garry kennedy");
    expect(row.search).toContain("0412345678");
    expect(row.search).toContain("coppin");
    expect(row.stale).toBe(false);
    expect(row.quote_at).toBe(daysAgo(4));
  });

  it("a logged call counts as activity and as contact — the fault the deep dive found", () => {
    const row = computeFactsRow(input({
      allEvents: [{ type: "call_no_answer", occurred_at: daysAgo(1) }],
      facts: { ...input().facts, estimates: [est()] },
    }), NOW);
    expect(row.last_activity_at).toBe(daysAgo(1));
    expect(row.last_contact_at).toBe(daysAgo(1));
  });

  it("counts opens from the log and totals open vs won value", () => {
    const row = computeFactsRow(input({
      allEvents: [
        { type: "estimate_viewed", occurred_at: daysAgo(3) },
        { type: "estimate_viewed", occurred_at: daysAgo(2) },
      ],
      facts: { ...input().facts, estimates: [est({ viewed_at: daysAgo(3) }), est({ id: "e0", status: "accepted", total_cents: 900_000, accepted_at: daysAgo(400), sent_at: daysAgo(410) })] },
    }), NOW);
    expect(row.opened_count).toBe(2);
    expect(row.last_opened_at).toBe(daysAgo(2));
    expect(row.won_cents).toBe(900_000);
    expect(row.open_value_cents).toBe(435_200);
    expect(row.estimates_count).toBe(2);
  });

  it("a draft never sent is not a quote date", () => {
    const row = computeFactsRow(input({ facts: { ...input().facts, estimates: [est({ status: "draft", sent_at: null })] } }), NOW);
    expect(row.quote_at).toBeNull();
    expect(row.stage).toBe("enquiry_unfinished");
  });

  it("the last job completed comes from the work order or the event, whichever the record has", () => {
    const row = computeFactsRow(input({
      allEvents: [{ type: "job_completed", occurred_at: daysAgo(40) }],
      facts: { ...input().facts, estimates: [est({ status: "accepted", accepted_at: daysAgo(60) })], workOrders: [{ status: "complete", start_date: daysAgo(50), end_date: daysAgo(40) }] },
    }), NOW);
    expect(row.last_job_completed_at?.slice(0, 10)).toBe(daysAgo(40).slice(0, 10));
    expect(row.stage).toBe("past_customer");
  });
});
