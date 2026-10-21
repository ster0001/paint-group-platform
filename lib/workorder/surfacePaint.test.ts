import { describe, expect, it } from "vitest";
import { paintLabel } from "./surfacePaint";

describe("paintLabel", () => {
  it("prints product · sheen · colour", () => {
    expect(paintLabel({ product: "Dulux Wash&Wear", finish: "Low Sheen", colourName: "Natural White" }))
      .toBe("Dulux Wash&Wear · Low Sheen · Natural White");
  });
  it("says the colour is to be confirmed in the Materials section's own words", () => {
    expect(paintLabel({ product: "Dulux Aquanamel", finish: "Semi Gloss", colourName: "" }))
      .toBe("Dulux Aquanamel · Semi Gloss · Colour to be confirmed");
    expect(paintLabel({ product: "Dulux Aquanamel" })).toBe("Dulux Aquanamel · Colour to be confirmed");
  });
  it("skips a missing sheen (documents frozen before 5 Sep 2026) without a dangling dot", () => {
    expect(paintLabel({ product: "Taubmans Endure", colourName: "Domino" })).toBe("Taubmans Endure · Domino");
  });
  it("is null for a line with no paint — an allowance prints no paint line", () => {
    expect(paintLabel({ product: "" })).toBeNull();
    expect(paintLabel({ product: "  ", finish: "Matt", colourName: "White" })).toBeNull();
  });
});
