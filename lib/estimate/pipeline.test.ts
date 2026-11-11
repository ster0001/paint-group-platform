import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES, type EstimateStage } from "@/lib/crm/estimateStage";
import { buildPipeline, stageAge, type PipelineCard } from "./pipeline";

const now = new Date("2026-11-11T03:00:00Z");
const card = (key: string, stage: EstimateStage, over: Partial<PipelineCard> = {}): PipelineCard => ({
  key, href: `/quote?id=${key}`, name: key, address: null, brand: null, jobType: null, valueCents: 100_000, valueIsGuess: false,
  viewCount: 0, cameBack: 0, accountId: null, temperature: null, snoozedUntil: null,
  stage: { stage, since: "2026-11-10T00:00:00Z", because: "", idle: false }, ...over,
});

describe("the Pipeline (brief §4.2)", () => {
  it("has every lane B2 → C5 in order, empty ones too", () => {
    const p = buildPipeline([], now);
    expect(p.lanes.map((l) => l.stage)).toEqual([...PIPELINE_STAGES]);
    expect(p.lanes[0].label).toBe("Range seen, no action");
    expect(p.total).toBe(0);
  });
  it("lane counts sum to the total, and stages outside the Pipeline are left off", () => {
    const p = buildPipeline([card("a", "estimate_sent"), card("b", "estimate_sent"), card("c", "visit_booked"), card("d", "accepted"), card("e", "online_now"), card("f", "cold")], now);
    expect(p.total).toBe(3);
    expect(p.lanes.reduce((s, l) => s + l.count, 0)).toBe(p.total);
    expect(p.lanes.find((l) => l.stage === "estimate_sent")!.valueCents).toBe(200_000);
  });
  it("a snoozed customer is counted, not shown, until the snooze ends", () => {
    const p = buildPipeline([card("a", "revised", { snoozedUntil: "2026-11-12T00:00:00Z" }), card("b", "revised", { snoozedUntil: "2026-11-10T00:00:00Z" })], now);
    expect(p.snoozed).toBe(1);
    expect(p.lanes.find((l) => l.stage === "revised")!.cards.map((c) => c.key)).toEqual(["b"]);
  });
  it("hot first, then the longest in stage", () => {
    const p = buildPipeline([
      card("new", "estimate_viewed", { stage: { stage: "estimate_viewed", since: "2026-11-10T00:00:00Z", because: "", idle: false } }),
      card("old", "estimate_viewed", { stage: { stage: "estimate_viewed", since: "2026-11-01T00:00:00Z", because: "", idle: false } }),
      card("hot", "estimate_viewed", { temperature: "hot" }),
      card("cold", "estimate_viewed", { temperature: "cold", stage: { stage: "estimate_viewed", since: "2026-10-01T00:00:00Z", because: "", idle: false } }),
    ], now);
    expect(p.lanes.find((l) => l.stage === "estimate_viewed")!.cards.map((c) => c.key)).toEqual(["hot", "old", "new", "cold"]);
  });
  it("stage age reads in plain units", () => {
    expect(stageAge("2026-11-11T02:59:30Z", now)).toBe("just now");
    expect(stageAge("2026-11-11T02:20:00Z", now)).toBe("40 min");
    expect(stageAge("2026-11-10T22:00:00Z", now)).toBe("5 h");
    expect(stageAge("2026-11-10T03:00:00Z", now)).toBe("1 day");
  });
});
