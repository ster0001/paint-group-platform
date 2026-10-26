import { describe, expect, it } from "vitest";
import { buildColourMatchItems, GROUP_OF_KIND, homeOf, KIND_WEIGHT, type ColourMatchQueueRow } from "./work-queue";

/**
 * Tom, 26 Oct 2026 (28 Logan Street, Canterbury): colour-match codes stopped
 * holding the walkthrough — the painter hands the customer the phone with the
 * codes still to come, and the office is told through the one work queue.
 * Pure builder over rows the staff-only RPC shapes; nothing is counted here.
 */
const row = (over: Partial<ColourMatchQueueRow> = {}): ColourMatchQueueRow => ({
  workOrderId: "wo1", woRef: "WO-LOGAN", where: "28 Logan Street, Canterbury", painter: "Harsh",
  stage: "walkthrough", products: "Dulux Professional Enamel, Dulux Wash and Wear",
  since: "2026-10-26T01:40:00.000Z", ...over,
});

describe("colour-match codes outstanding at the hand-over", () => {
  it("is a PC Command item, keyed once per job, naming the paints and opening the job's colour card", () => {
    const [item] = buildColourMatchItems([row()], new Date("2026-10-26T02:00:00.000Z"));
    expect(item.kind).toBe("colour_match_outstanding");
    expect(homeOf(item.kind)).toBe("pc");
    expect(item.key).toBe("colour_match_outstanding:work_order:wo1:codes");
    expect(item.title).toContain("WO-LOGAN");
    expect(item.detail).toContain("Harsh went to the walkthrough without codes for Dulux Professional Enamel, Dulux Wash and Wear");
    expect(item.action.href).toBe("/pc/wo/wo1#colour-matches");
    expect(item.bucket, "due tomorrow, Melbourne time").toBe("waiting");
  });

  it("a day on it is overdue; a closed job reads as finished without the codes", () => {
    const [item] = buildColourMatchItems([row({ stage: "closed" })], new Date("2026-10-28T03:00:00.000Z"));
    expect(item.bucket).toBe("overdue");
    expect(item.detail).toContain("Harsh finished without codes");
  });

  it("sits with the painter-raised cards, a follow-up, below a day with nobody on it", () => {
    expect(KIND_WEIGHT.colour_match_outstanding).toBe(27);
    expect(KIND_WEIGHT.colour_match_outstanding).toBeLessThan(KIND_WEIGHT.employee_reassign);
    expect(GROUP_OF_KIND.colour_match_outstanding).toBe("followups");
  });

  it("no rows, no items", () => {
    expect(buildColourMatchItems([], new Date())).toEqual([]);
  });
});
