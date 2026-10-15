import { describe, expect, it } from "vitest";
import { labourCostCents } from "./labour";

describe("labourCostCents — the SQL round(hours * rate)", () => {
  it("7.5 h at $37 is $277.50; 7.6 h at $52.50 is $399.00; 1.5 h at $52.50 is $78.75", () => {
    expect(labourCostCents(7.5, 3700)).toBe(27_750);
    expect(labourCostCents(7.6, 5250)).toBe(39_900);
    expect(labourCostCents(1.5, 5250)).toBe(7_875);
  });
  it("rounds half-cents the way Postgres round() does and prices nothing for no hours or no rate", () => {
    expect(labourCostCents(0.33, 3700)).toBe(1_221); // 1220.99… → 1221
    expect(labourCostCents(0, 3700)).toBe(0);
    expect(labourCostCents(7.5, 0)).toBe(0);
    expect(labourCostCents(Number.NaN, 3700)).toBe(0);
  });
});
