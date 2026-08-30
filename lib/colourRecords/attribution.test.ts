import { test, expect } from "vitest";
import { foldAddressKey, matchKey } from "./attribution";

test("street-type abbreviations fold both directions", () => {
  expect(matchKey({ street: "22 Ormond Road", suburb: "Elwood", postcode: "3184" }))
    .toBe(matchKey({ street: "22 Ormond Rd", suburb: "Elwood", postcode: "3184" }));
  expect(matchKey({ street: "9 Mitford Street", suburb: "St Kilda", postcode: "3182" }))
    .toBe(matchKey({ street: "9 Mitford St", suburb: "St Kilda", postcode: "3182" }));
});

test("unit prefixes fold: 'Unit 7/22 Ormond Rd' matches '7/22 Ormond Road'", () => {
  expect(matchKey({ street: "Unit 7/22 Ormond Rd", suburb: "Elwood", postcode: "3184" }))
    .toBe(matchKey({ street: "7/22 Ormond Road", suburb: "Elwood", postcode: "3184" }));
});

test("different numbers or streets do NOT match — no fuzziness", () => {
  const a = matchKey({ street: "12 Acacia St", suburb: "Northcote", postcode: "3070" });
  expect(a).not.toBe(matchKey({ street: "14 Acacia St", suburb: "Northcote", postcode: "3070" }));
  expect(a).not.toBe(matchKey({ street: "12 Acacia Ave", suburb: "Northcote", postcode: "3070" }));
});

test("'st' as a suburb word (St Kilda) is untouched — only street-TYPE tokens fold", () => {
  // 'st' is already the short form; folding maps long→short, so St Kilda's
  // 'st' passes through identically on both sides.
  expect(foldAddressKey("9 mitford st st kilda 3182")).toBe("9 mitford st st kilda 3182");
});

test("no street → null, never a match-all key", () => {
  expect(matchKey({ street: "", suburb: "Elwood", postcode: "3184" })).toBeNull();
});
