import { describe, expect, it } from "vitest";
import { paintOptions } from "./materials";

/**
 * Tom, 18 Sep 2026: a search box and A-Z ordering on the Materials paint list.
 * The rule that matters most is the last one — filtering must never be able to
 * drop the paint a job is already quoted with.
 */
const P = (name: string, type?: string | null) => ({ name, type: type ?? null });
const CATALOGUE = [
  P("Wash & Wear Low Sheen", "Interior"),
  P("aquanamel Gloss", "Interior"),
  P("Weathershield Gloss", "Exterior"),
  P("Ceiling White", "Interior"),
  P("All-purpose Primer", null),
];

describe("paintOptions", () => {
  const names = (o: { name: string }[]) => o.map((p) => p.name);

  it("orders A-Z, ignoring case, and keeps a typeless paint in both lists", () => {
    expect(names(paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "", search: "" })))
      .toEqual(["All-purpose Primer", "aquanamel Gloss", "Ceiling White", "Wash & Wear Low Sheen"]);
    expect(names(paintOptions(CATALOGUE, { surfaceType: "Exterior", chosen: "", search: "" })))
      .toEqual(["All-purpose Primer", "Weathershield Gloss"]);
  });

  it("narrows on what was typed, anywhere in the name, case-insensitively", () => {
    expect(names(paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "", search: "gloss" })))
      .toEqual(["aquanamel Gloss"]);
    expect(names(paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "", search: "  WASH " })))
      .toEqual(["Wash & Wear Low Sheen"]);
    expect(paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "", search: "zzz" })).toHaveLength(0);
  });

  it("NEVER drops the paint already chosen — not by search, not by type", () => {
    // Searching for something else must not remove it, or the select would
    // silently display a different product as this job's paint.
    expect(names(paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "Wash & Wear Low Sheen", search: "zzz" })))
      .toEqual(["Wash & Wear Low Sheen"]);
    // An exterior paint chosen on an interior row stays listed too.
    expect(names(paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "Weathershield Gloss", search: "" })))
      .toContain("Weathershield Gloss");
  });

  it("does not mutate the catalogue it was given", () => {
    const before = names(CATALOGUE);
    paintOptions(CATALOGUE, { surfaceType: "Interior", chosen: "", search: "" });
    expect(names(CATALOGUE)).toEqual(before);
  });
});
