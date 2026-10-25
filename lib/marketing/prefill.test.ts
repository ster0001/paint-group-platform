import { test, expect } from "vitest";
import { parseEstimateIntent } from "./prefill";

test("a home hand-off keeps the address and leaves the property kind alone", () => {
  expect(parseEstimateIntent({ address: "12 Elm Street, Northcote VIC 3070", mode: "home" })).toEqual({
    addressText: "12 Elm Street, Northcote VIC 3070",
    address: null,
    propertyKind: null,
    scope: null,
    from: null,
    mode: "home",
    brand: null, entrySource: "direct",
  });
});

test("the entry source rides as src, validated; a job page implies job_page:<slug> (buckets brief §2.1)", () => {
  expect(parseEstimateIntent({ src: "homepage_hero" }).entrySource).toBe("homepage_hero");
  expect(parseEstimateIntent({ from: "exterior-weatherboard-thornbury" }).entrySource).toBe("job_page:exterior-weatherboard-thornbury");
  expect(parseEstimateIntent({ src: "<script>" }).entrySource).toBe("direct");
  expect(parseEstimateIntent({}).mode).toBeNull();
});

test("business pre-selects commercial", () => {
  expect(parseEstimateIntent({ address: "4/22 High St", mode: "business" }).propertyKind).toBe("commercial");
});

test("junk mode is ignored, not an error", () => {
  expect(parseEstimateIntent({ address: "x", mode: "biz" }).propertyKind).toBeNull();
  expect(parseEstimateIntent({ mode: ["home", "business"] }).propertyKind).toBeNull();
});

test("the address is cleaned and clamped to the wizard's cap", () => {
  const long = "a".repeat(400);
  const r = parseEstimateIntent({ address: `  12  Elm   St\n\t${long}` });
  expect(r.addressText?.length).toBe(250);
  expect(r.addressText?.startsWith("12 Elm St a")).toBe(true);
});

test("nothing usable → null, so the wizard starts blank", () => {
  expect(parseEstimateIntent({}).addressText).toBeNull();
  expect(parseEstimateIntent({ address: "   " }).addressText).toBeNull();
});

test("scope and from are validated, never trusted", () => {
  const ok = parseEstimateIntent({ scope: "exterior", from: "Exterior-Weatherboard-Thornbury" });
  expect(ok.scope).toBe("exterior");
  expect(ok.from).toBe("exterior-weatherboard-thornbury");
  const bad = parseEstimateIntent({ scope: "roof", from: "../etc; drop table" });
  expect(bad.scope).toBeNull();
  expect(bad.from).toBeNull();
});

test("Tom, 25 Oct 2026: the homepage's resolved pick rides the hand-off and comes back as the address", () => {
  const got = parseEstimateIntent({ address: "14 Acacia Street, Northcote VIC 3070", street: "14 Acacia Street", suburb: "Northcote", state: "VIC", postcode: "3070" });
  expect(got.address).toEqual({ street: "14 Acacia Street", suburb: "Northcote", state: "VIC", postcode: "3070", formatted: "14 Acacia Street, Northcote VIC 3070" });
  // words alone are still only words
  expect(parseEstimateIntent({ address: "14 Acacia Street Northcote" }).address).toBeNull();
  // a pick needs a suburb AND a numeric postcode
  expect(parseEstimateIntent({ suburb: "Northcote" }).address).toBeNull();
  expect(parseEstimateIntent({ suburb: "Northcote", postcode: "abc" }).address).toBeNull();
  // parts without the words still give the wizard something to show
  expect(parseEstimateIntent({ suburb: "Northcote", postcode: "3070" }).addressText).toBe("Northcote, 3070");
});
