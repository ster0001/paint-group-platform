import { test } from "vitest";
import assert from "node:assert/strict";
import { parseAddressText } from "./addressText";

test("the line the assistant refused on 6 Sep parses into street, suburb and postcode", () => {
  const a = parseAddressText("14 Murrumbeena Rd, Murrumbeena 3163");
  assert.ok(a);
  assert.equal(a.street, "14 Murrumbeena Rd");
  assert.equal(a.suburb, "Murrumbeena");
  assert.equal(a.postcode, "3163");
  assert.equal(a.state, "VIC");
  assert.equal(a.formatted, "14 Murrumbeena Rd, Murrumbeena VIC 3163");
});

test("no comma: the street type splits street from suburb; a state is picked up and removed", () => {
  const a = parseAddressText("9 Elm Street Bentleigh VIC 3204");
  assert.ok(a);
  assert.equal(a.street, "9 Elm Street");
  assert.equal(a.suburb, "Bentleigh");
  assert.equal(a.state, "VIC");
  assert.equal(a.postcode, "3204");
  const b = parseAddressText("Unit 2/40 High St, Northcote, VIC, 3070");
  assert.ok(b);
  assert.equal(b.postcode, "3070");
  assert.equal(b.suburb, "Northcote");
  assert.equal(b.street, "Unit 2/40 High St");
});

test("a suburb and postcode alone is enough; a bare street or nothing is not", () => {
  const a = parseAddressText("Murrumbeena 3163");
  assert.ok(a);
  assert.equal(a.suburb, "Murrumbeena");
  assert.equal(a.street, "");
  assert.equal(parseAddressText("14 Something Rd"), null);
  assert.equal(parseAddressText("   "), null);
});
