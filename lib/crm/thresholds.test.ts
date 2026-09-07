import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, mergeThresholds } from "./thresholds";

describe("CRM thresholds (Settings → CRM)", () => {
  it("merges a saved row over the defaults and ignores nonsense", () => {
    const t = mergeThresholds({ chaseUnopenedDays: 2, goingColdDays: "soon", repaintExteriorYears: 0, messageOverdueHours: 8 });
    expect(t.chaseUnopenedDays).toBe(2);
    expect(t.goingColdDays).toBe(DEFAULT_THRESHOLDS.goingColdDays);
    expect(t.repaintExteriorYears).toBe(DEFAULT_THRESHOLDS.repaintExteriorYears);
    expect(t.messageOverdueHours).toBe(8);
    expect(mergeThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
  });
});
