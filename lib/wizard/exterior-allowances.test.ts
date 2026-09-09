import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTERIOR_ALLOWANCES, SCAFFOLD_EXCLUSION,
  exteriorAccessAllowances, exteriorAllowancesFrom,
} from "./exterior-allowances";

const base = {
  storeys: "single" as const,
  access: [] as string[],
  accessEquipment: [] as string[],
  sidesPainted: 4,
};

/**
 * The shape argument, which is the whole reason these are hours: a second
 * storey adds set-up and pack-down, not painting time, so the cost is the
 * same whether the wall above it is 6 m or 16 m long.
 */
describe("height is hours, per side being painted", () => {
  it("charges nothing on a single-storey job with easy access", () => {
    const out = exteriorAccessAllowances(base);
    expect(out.allowances).toEqual([]);
    expect(out.deferred).toEqual([]);
  });

  it("allows the upper-storey hours once per side", () => {
    const out = exteriorAccessAllowances({ ...base, storeys: "double" });
    expect(out.allowances).toHaveLength(1);
    expect(out.allowances[0].hours).toBe(DEFAULT_EXTERIOR_ALLOWANCES.upperStoreyPerSide * 4);
  });

  it("charges three sides when only three are being painted", () => {
    const out = exteriorAccessAllowances({ ...base, storeys: "double", sidesPainted: 3 });
    expect(out.allowances[0].hours).toBe(DEFAULT_EXTERIOR_ALLOWANCES.upperStoreyPerSide * 3);
  });

  it("charges nothing for elevations on a fence-or-deck-only job", () => {
    // No sides being painted means no elevation to reach. Charging set-up for
    // walls nobody is painting is how a quote loses on price for no reason.
    const out = exteriorAccessAllowances({ ...base, storeys: "double", sidesPainted: 0 });
    expect(out.allowances).toEqual([]);
  });

  it("treats a ticked 'high' as an upper level even on a single storey", () => {
    const out = exteriorAccessAllowances({ ...base, access: ["high"] });
    expect(out.allowances.map((a) => a.key)).toContain("upper_storey");
  });
});

describe("awkward ground is one allowance, not four guesses", () => {
  it("allows it once for the job, because that is how it was asked", () => {
    const out = exteriorAccessAllowances({ ...base, access: ["steep"] });
    const ground = out.allowances.find((a) => a.key === "difficult_ground");
    expect(ground?.hours).toBe(DEFAULT_EXTERIOR_ALLOWANCES.difficultGroundPerSide);
  });

  it("does not double up when both steep and tight are ticked", () => {
    const out = exteriorAccessAllowances({ ...base, access: ["steep", "tight"] });
    expect(out.allowances.filter((a) => a.key === "difficult_ground")).toHaveLength(1);
  });
});

/**
 * ⚑ Tom asked whether there is a threshold at which we absorb scaffolding.
 * There is not, deliberately: a threshold means the estimate quietly carries
 * a cost nobody priced, on exactly the jobs where it is largest.
 */
describe("scaffold is always a variation", () => {
  it("prices no hours for it, and says so on the quote", () => {
    const out = exteriorAccessAllowances({ ...base, accessEquipment: ["scaffold"] });
    expect(out.allowances.some((a) => /scaffold/i.test(a.label))).toBe(false);
    expect(out.exclusions).toContain(SCAFFOLD_EXCLUSION);
    expect(out.deferred.some((d) => d.kind === "exterior_access_equipment")).toBe(true);
  });

  it("names the equipment the customer actually ticked", () => {
    const out = exteriorAccessAllowances({ ...base, accessEquipment: ["boom_lift"] });
    expect(out.deferred[0].needs).toContain("boom lift");
  });
});

/**
 * These numbers are a proposal, not Tom's. An estimator has to be able to see
 * that a job carries them, or they can never be corrected against actuals.
 */
describe("every allowance is flagged for correction", () => {
  it("raises one note naming the hours and where to change them", () => {
    const out = exteriorAccessAllowances({ ...base, storeys: "double", access: ["steep"] });
    const flag = out.deferred.find((d) => d.kind === "exterior_access_allowance");
    expect(flag).toBeTruthy();
    expect(flag!.needs).toMatch(/provisional/i);
    expect(flag!.needs).toMatch(/Settings/);
    expect(flag!.needs).toContain("9.5 h"); // 2 × 4 sides + 1.5
  });

  it("raises nothing at all when nothing was allowed", () => {
    expect(exteriorAccessAllowances(base).deferred).toEqual([]);
  });
});

describe("the numbers are Tom's to change", () => {
  it("takes them from Settings", () => {
    const s = exteriorAllowancesFrom({ upperStoreyPerSide: 3, difficultGroundPerSide: 0 });
    expect(s.upperStoreyPerSide).toBe(3);
    expect(s.difficultGroundPerSide).toBe(0);
    // Zero is a real answer — "we don't charge for that" must be sayable.
    const out = exteriorAccessAllowances({ ...base, access: ["steep"] }, s);
    expect(out.allowances.some((a) => a.key === "difficult_ground")).toBe(false);
  });

  it("falls back rather than trusting rubbish", () => {
    for (const bad of [null, "2", { upperStoreyPerSide: -1 }, { upperStoreyPerSide: 999 }]) {
      expect(exteriorAllowancesFrom(bad).upperStoreyPerSide)
        .toBe(DEFAULT_EXTERIOR_ALLOWANCES.upperStoreyPerSide);
    }
  });
});
