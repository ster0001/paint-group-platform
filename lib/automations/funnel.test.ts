import { describe, expect, it } from "vitest";
import { FUNNEL_KEYS, FUNNEL_STAGES, codeOf } from "./funnel";
import { AUTOMATIONS, automationByKey } from "./registry";

/** A‑C (17 Nov 2026): Campaigns › Automations lists the funnel; every row is a real key, and every funnel key built is on it. */
describe("the funnel list", () => {
  it("every key is in the registry, once", () => {
    const keys = FUNNEL_STAGES.flatMap((s) => s.rows.map((r) => r.key).filter(Boolean));
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(automationByKey(k as string), k as string).toBeTruthy();
  });
  it("every key the automations brief added is on the funnel screen", () => {
    const briefKeys = AUTOMATIONS.filter((a) => a.defaultOff).map((a) => a.key);
    for (const k of briefKeys) expect(FUNNEL_KEYS.has(k), k).toBe(true);
  });
  it("the plan's codes read in order", () => {
    expect(codeOf("lead_range_reminder")).toBe("L1");
    expect(codeOf("estimate_viewed_any_q")).toBe("E4");
    expect(codeOf("cold_nurture")).toBe("R5");
    expect(FUNNEL_STAGES.map((s) => s.id)).toEqual(["lead", "estimate", "won", "after"]);
  });
});
