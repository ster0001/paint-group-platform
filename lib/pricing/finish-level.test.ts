import { describe, expect, it } from "vitest";
import { finishLevelChosen } from "./finish-level";
import { jobModifier } from "./estimate";

const mods = [{ code: "FIN-2", group_name: "Level of Finish", multiplier: 1.1 }, { code: "COND-1", group_name: "Condition", multiplier: 1 }];

describe("⚑A — the finish-level split is recorded, not changed", () => {
  it("production defaults a missing finish level to ×1 (the behaviour every estimate was priced with)", () => {
    expect(jobModifier(mods as never, {})).toBe(1);
    expect(jobModifier(mods as never, { "Level of Finish": "FIN-2" })).toBeCloseTo(1.1);
  });
  it("finishLevelChosen says whether one was picked, and never throws", () => {
    expect(finishLevelChosen(mods as never, {})).toBe(false);
    expect(finishLevelChosen(mods as never, { "Level of Finish": "FIN-2" })).toBe(true);
    expect(finishLevelChosen(mods as never, { "Level of Finish": "nope" })).toBe(false);
  });
});
