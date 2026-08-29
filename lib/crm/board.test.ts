import { describe, expect, it } from "vitest";
import { buildBoard, type BoardInput } from "./board";
import { THRESHOLDS, type AccountFacts } from "./stage";

const NOW = new Date("2026-08-29T10:00:00+10:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const person = (over: Omit<Partial<BoardInput>, "facts"> & { facts?: Partial<AccountFacts> } = {}): BoardInput => ({
  accountId: over.accountId ?? "a1",
  name: over.name ?? "Sarah Mitchell",
  meta: over.meta ?? "Camberwell · Interior",
  valueCents: over.valueCents ?? 842_000,
  source: over.source ?? null,
  note: over.note ?? null,
  facts: {
    estimates: [], workOrders: [], events: [],
    temperature: null, snoozedUntil: null, followupDueAt: null,
    ...(over.facts ?? {}),
  },
});

const sentEstimate = (d: number, over: Record<string, unknown> = {}) => ({
  id: `e${d}`, status: "sent", total_cents: 842_000,
  created_at: daysAgo(d + 1), sent_at: daysAgo(d), viewed_at: null,
  accepted_at: null, declined_at: null, ...over,
});

describe("buildBoard", () => {
  it("lays out the mockup's seven lanes, always, even when empty", () => {
    const b = buildBoard([], NOW);
    expect(b.lanes.map((l) => l.label)).toEqual([
      "Enquiry unfinished", "Estimate sent", "Visit booked",
      "Visit done, no reply", "Negotiating", "Job on", "Past customers",
    ]);
    expect(b.open).toBe(0);
    expect(b.tiles.winRatePct).toBeNull();
  });

  it("counts what is open and what needs you today", () => {
    const b = buildBoard([
      person({ accountId: "quiet", facts: { estimates: [sentEstimate(1)] } }),
      person({ accountId: "chase", facts: { estimates: [sentEstimate(THRESHOLDS.chaseUnopenedDays + 1)] } }),
      person({ accountId: "done", facts: {
        workOrders: [{ status: "complete", start_date: daysAgo(400), end_date: daysAgo(380) }],
      } }),
    ], NOW);
    expect(b.open).toBe(2);          // the past customer is not "open"
    expect(b.needsYou).toBe(1);
  });

  it("adds up only the open work — a finished job is not pipeline", () => {
    const b = buildBoard([
      person({ accountId: "open", valueCents: 500_000, facts: { estimates: [sentEstimate(2)] } }),
      person({ accountId: "past", valueCents: 999_000, facts: {
        workOrders: [{ status: "complete", start_date: daysAgo(400), end_date: daysAgo(380) }],
      } }),
    ], NOW);
    expect(b.tiles.openValueCents).toBe(500_000);
  });

  it("puts whoever needs you at the top of a lane, then the biggest job", () => {
    const b = buildBoard([
      person({ accountId: "small-urgent", valueCents: 100_000,
        facts: { estimates: [sentEstimate(THRESHOLDS.chaseUnopenedDays + 2)] } }),
      person({ accountId: "big-quiet", valueCents: 4_680_000, facts: { estimates: [sentEstimate(1)] } }),
      person({ accountId: "mid-quiet", valueCents: 900_000, facts: { estimates: [sentEstimate(1)] } }),
    ], NOW);
    const lane = b.lanes.find((l) => l.key === "estimate_sent")!;
    expect(lane.cards.map((c) => c.accountId)).toEqual(["small-urgent", "big-quiet", "mid-quiet"]);
  });

  it("words the chips the way the mockup does", () => {
    const b = buildBoard([person({
      facts: { estimates: [sentEstimate(THRESHOLDS.chaseUnopenedDays + 1)], followupDueAt: daysAgo(2) },
    })], NOW);
    const card = b.lanes.find((l) => l.key === "estimate_sent")!.cards[0];
    expect(card.chips).toContain("Follow-up overdue");
    expect(card.chips).toContain("Chase due");
  });

  it("says a snooze ran out, because that is when the card comes back", () => {
    const ran = buildBoard([person({ facts: { estimates: [sentEstimate(20)], snoozedUntil: daysAgo(1) } })], NOW);
    expect(ran.lanes.find((l) => l.key === "estimate_sent")!.cards[0].chips).toContain("Snooze ran out");

    const still = buildBoard([person({ facts: { estimates: [sentEstimate(20)], snoozedUntil: daysAgo(-5) } })], NOW);
    const card = still.lanes.find((l) => l.key === "estimate_sent")!.cards[0];
    expect(card.chips.some((c) => c.startsWith("Snoozed to"))).toBe(true);
    expect(card.needsYou).toBe(false);
  });

  it("keeps a snoozed card out of the tiles it would otherwise inflate", () => {
    const b = buildBoard([person({
      facts: { estimates: [sentEstimate(40)], snoozedUntil: daysAgo(-7), followupDueAt: daysAgo(3) },
    })], NOW);
    expect(b.needsYou).toBe(0);
    expect(b.tiles.overdueFollowups).toBe(0);
    expect(b.tiles.goingCold).toBe(0);
  });

  it("computes a win rate from what was decided, and refuses to when nothing was", () => {
    const b = buildBoard([
      person({ accountId: "w1", facts: { estimates: [sentEstimate(10, { accepted_at: daysAgo(8), status: "accepted" })] } }),
      person({ accountId: "w2", facts: { estimates: [sentEstimate(20, { accepted_at: daysAgo(18), status: "accepted" })] } }),
      person({ accountId: "l1", facts: { estimates: [sentEstimate(30, { declined_at: daysAgo(28), status: "declined" })] } }),
      // Decided long ago: outside the 90-day window, so it counts for nothing.
      person({ accountId: "old", facts: { estimates: [sentEstimate(400, { declined_at: daysAgo(380), status: "declined" })] } }),
    ], NOW);
    expect(b.tiles.winRateOf).toBe(3);
    expect(b.tiles.winRatePct).toBe(67);

    expect(buildBoard([person({ facts: { estimates: [sentEstimate(2)] } })], NOW).tiles.winRatePct).toBeNull();
  });
});
