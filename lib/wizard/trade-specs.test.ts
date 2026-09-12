/**
 * C15 — specs as rows: the row body round-trips through the saved-spec
 * shape the wizard applies, and a bad row is dropped rather than thrown.
 */
import { describe, expect, it } from "vitest";
import { rowBodyFromSpec, specFromRow, tradeSpecBodySchema } from "./trade-specs";
import { applySpec, specFromState, specSummary } from "./saved-specs";
import { defaultWizardState } from "./state";

describe("trade specs", () => {
  it("a state → spec → row body → row → spec round-trip keeps every answer", () => {
    const state = defaultWizardState();
    state.surfaces = ["walls", "ceilings"];
    state.condition.tier = "fresh";
    state.details.damageTier = 0;
    state.details.siteAccess = { cleared: "yes", lift: "no" };
    const spec = specFromState(state, "End-of-lease repaint", { colourPolicy: "vacate white" });
    const body = rowBodyFromSpec(spec);
    expect(body.colourMode).toBe("register");
    expect(body.surfaces).toEqual(["walls", "ceilings"]);
    const back = specFromRow({ id: "row-1", account_id: "acct", name: "End-of-lease repaint", spec: body, used_count: 19, created_at: "2026-09-01T00:00:00Z" });
    expect(back).not.toBeNull();
    expect(back!.id).toBe("row-1");
    expect(back!.usedCount).toBe(19);
    expect(back!.colourPolicy).toBe("vacate white");
    const applied = applySpec(defaultWizardState(), back!);
    expect(applied.surfaces).toEqual(["walls", "ceilings"]);
    expect(applied.condition.tier).toBe("fresh");
    expect(applied.details.siteAccess).toEqual({ cleared: "yes", lift: "no" });
    expect(specSummary(back!)).toBe("2 surfaces · same colours · good");
  });
  it("walk C's brand fields ride the body without touching the wizard shape", () => {
    const body = tradeSpecBodySchema.parse({
      surfaces: ["walls"], tier: "change", damageTier: 1,
      colourMode: "brand", brandColours: { walls: "Brand Grey" }, segment: "franchise", hours: "after 6pm",
    });
    expect(body.colourMode).toBe("brand");
    expect(body.brandColours?.walls).toBe("Brand Grey");
  });
  it("drops an unusable row instead of throwing", () => {
    expect(specFromRow({ id: "x", account_id: "a", name: "Broken", spec: { surfaces: [] }, used_count: 0, created_at: null })).toBeNull();
    expect(specFromRow({ id: "x", account_id: "a", name: "Broken", spec: "junk", used_count: 0, created_at: null })).toBeNull();
  });
});
