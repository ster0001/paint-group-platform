import { describe, expect, it } from "vitest";
import { brandPillLabel, matchesBrand, parseBrandFilter } from "./filter";

describe("the staff brand filter and pill (paint-home brief §6)", () => {
  it("parses the three values and nothing else", () => {
    expect(parseBrandFilter("painthome")).toBe("painthome");
    expect(parseBrandFilter("paintgroup")).toBe("paintgroup");
    expect(parseBrandFilter(undefined)).toBe("all");
    expect(parseBrandFilter("x")).toBe("all");
  });
  it("a missing brand is Paint Group; the filter keeps what it names", () => {
    expect(matchesBrand(null, "paintgroup")).toBe(true);
    expect(matchesBrand(undefined, "painthome")).toBe(false);
    expect(matchesBrand("painthome", "painthome")).toBe(true);
    expect(matchesBrand("painthome", "paintgroup")).toBe(false);
    expect(matchesBrand("painthome", "all")).toBe(true);
  });
  it("only Paint Home rows wear a pill", () => {
    expect(brandPillLabel("painthome")).toBe("Paint Home");
    expect(brandPillLabel("paintgroup")).toBeNull();
    expect(brandPillLabel(null)).toBeNull();
    // Tom, 25 Oct 2026: the Estimates list names both shopfronts
    expect(brandPillLabel("paintgroup", true)).toBe("Paint Group");
    expect(brandPillLabel(null, true)).toBe("Paint Group");
    expect(brandPillLabel("painthome", true)).toBe("Paint Home");
  });
});
