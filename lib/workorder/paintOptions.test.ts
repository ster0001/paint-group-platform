import { describe, expect, it } from "vitest";
import { paintOptions } from "./materials";

/**
 * Tom, 18 Sep 2026: a search box and A-Z ordering on the paint lists.
 * Tom, 8 Oct 2026: every paint is offered on every row — no Interior/Exterior
 * pigeon-holing. The rule that matters most is still the chosen-paint one —
 * filtering must never drop the paint a job is already quoted with.
 */
type P = { name: string; type: string | null; brand?: string | null; finish?: string | null };
const P = (name: string, type?: string | null, extra: Partial<P> = {}): P => ({ name, type: type ?? null, ...extra });
const CATALOGUE = [
  P("Wash & Wear Low Sheen", "Interior", { brand: "Dulux", finish: "Low Sheen" }),
  P("aquanamel Gloss", "Interior", { brand: "Dulux", finish: "Gloss" }),
  P("Weathershield Gloss", "Exterior", { brand: "Dulux", finish: "Gloss" }),
  P("Ceiling White", "Interior", { brand: "Haymes", finish: "Flat" }),
  P("All-purpose Primer", null),
];

describe("paintOptions", () => {
  const names = (o: { name: string }[]) => o.map((p) => p.name);

  it("offers every paint, Interior, Exterior and typeless alike, A-Z ignoring case", () => {
    expect(names(paintOptions(CATALOGUE, { chosen: "", search: "" })))
      .toEqual(["All-purpose Primer", "aquanamel Gloss", "Ceiling White", "Wash & Wear Low Sheen", "Weathershield Gloss"]);
  });

  it("narrows on what was typed — name, brand or finish — case-insensitively", () => {
    expect(names(paintOptions(CATALOGUE, { chosen: "", search: "gloss" })))
      .toEqual(["aquanamel Gloss", "Weathershield Gloss"]);
    expect(names(paintOptions(CATALOGUE, { chosen: "", search: "  WASH " })))
      .toEqual(["Wash & Wear Low Sheen"]);
    expect(names(paintOptions(CATALOGUE, { chosen: "", search: "haymes" })))
      .toEqual(["Ceiling White"]);
    expect(names(paintOptions(CATALOGUE, { chosen: "", search: "low sheen" })))
      .toEqual(["Wash & Wear Low Sheen"]);
    expect(paintOptions(CATALOGUE, { chosen: "", search: "zzz" })).toHaveLength(0);
  });

  it("NEVER drops the paint already chosen, whatever the search says", () => {
    expect(names(paintOptions(CATALOGUE, { chosen: "Wash & Wear Low Sheen", search: "zzz" })))
      .toEqual(["Wash & Wear Low Sheen"]);
    expect(names(paintOptions(CATALOGUE, { chosen: "Weathershield Gloss", search: "ceiling" })))
      .toEqual(["Ceiling White", "Weathershield Gloss"]);
  });

  it("does not mutate the catalogue it was given", () => {
    const before = names(CATALOGUE);
    paintOptions(CATALOGUE, { chosen: "", search: "" });
    expect(names(CATALOGUE)).toEqual(before);
  });
});
