import { test } from "vitest";
import assert from "node:assert/strict";
import { contactFieldProblems, isAuMobile, isFullEmail } from "./contact";

test("AU mobiles: 04… and +614… in, everything else out", () => {
  assert.ok(isAuMobile("0491 570 006"));
  assert.ok(isAuMobile("0491570006"));
  assert.ok(isAuMobile("+61 491 570 006"));
  assert.ok(isAuMobile("61422453136"));
  assert.ok(!isAuMobile("0422 453 13"));    // one digit short
  assert.ok(!isAuMobile("03 8840 9414"));   // a landline is not a mobile
  assert.ok(!isAuMobile("0422"));
  assert.ok(!isAuMobile("+44 7911 123456")); // not Australian
});

test("emails must be whole", () => {
  assert.ok(isFullEmail("tom@paintgroup.com.au"));
  assert.ok(!isFullEmail("tom@"));
  assert.ok(!isFullEmail("tom@paintgroup"));
  assert.ok(!isFullEmail("@paintgroup.com"));
  assert.ok(!isFullEmail("tom paintgroup.com"));
});

test("empty fields stay allowed; the first problem names itself", () => {
  assert.equal(contactFieldProblems({ phone: "", email: "" }), null);
  assert.equal(contactFieldProblems({ phone: null, email: null }), null);
  assert.match(contactFieldProblems({ phone: "0422", email: "" }) ?? "", /Australian mobile/);
  assert.match(contactFieldProblems({ phone: "", email: "tom@" }) ?? "", /full address/);
});
