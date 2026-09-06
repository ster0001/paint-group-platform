import { test } from "vitest";
import assert from "node:assert/strict";
import { decodeResume, encodeResume, resumeLine, RESUME_MAX_AGE_MS } from "./resume";
import { defaultCustomer, defaultWizardState } from "./state";

const now = new Date("2026-09-07T10:00:00+10:00");
const customerState = () => ({
  ...defaultWizardState(),
  mode: "customer" as const,
  customer: { ...defaultCustomer(), suburb: "Murrumbeena", postcode: "3163" },
});
const answered = { heritage: true, pre1970: false, asbestos: false };

test("a fresh record on page 3 comes back whole — page, state, safety taps, typed address", () => {
  const raw = encodeResume({ savedAt: now.toISOString(), page: 3, state: customerState(), answered, addressText: "14 Murrumbeena Rd" });
  const r = decodeResume(raw, now);
  assert.ok(r);
  assert.equal(r.page, 3);
  assert.equal(r.state.customer?.suburb, "Murrumbeena");
  assert.deepEqual(r.answered, answered);
  assert.equal(r.addressText, "14 Murrumbeena Rd");
});

test("nothing to resume: missing, garbage, wrong version, stale, or page 1 with nothing typed", () => {
  assert.equal(decodeResume(null, now), null);
  assert.equal(decodeResume("{not json", now), null);
  assert.equal(decodeResume(JSON.stringify({ v: 2, savedAt: now.toISOString(), page: 3, state: customerState() }), now), null);
  const stale = new Date(now.getTime() - RESUME_MAX_AGE_MS - 1000);
  assert.equal(decodeResume(encodeResume({ savedAt: stale.toISOString(), page: 3, state: customerState(), answered, addressText: "" }), now), null);
  const blank = { ...defaultWizardState(), mode: "customer" as const, customer: defaultCustomer() };
  assert.equal(decodeResume(encodeResume({ savedAt: now.toISOString(), page: 1, state: blank, answered, addressText: "" }), now), null);
});

test("a malformed state never crashes the wizard — it is simply not resumed", () => {
  const raw = JSON.stringify({ v: 1, savedAt: now.toISOString(), page: 2, state: { jobType: "spaceship" }, answered });
  assert.equal(decodeResume(raw, now), null);
});

test("arriving from the homepage with a DIFFERENT address starts fresh; the same address resumes", () => {
  const raw = encodeResume({ savedAt: now.toISOString(), page: 3, state: customerState(), answered, addressText: "14 Murrumbeena Rd, Murrumbeena VIC 3163" });
  assert.equal(decodeResume(raw, now, { incomingAddress: "9 Elm Street, Malvern" }), null);
  assert.ok(decodeResume(raw, now, { incomingAddress: "14 Murrumbeena Rd, Murrumbeena VIC 3163" }));
  assert.ok(decodeResume(raw, now, { incomingAddress: "14 murrumbeena rd" }), "a shorter re-type of the same address still resumes");
  assert.ok(decodeResume(raw, now, { incomingAddress: "" }), "no incoming address = a plain return visit");
  // Only a suburb was ever typed: the suburb decides.
  const suburbOnly = encodeResume({ savedAt: now.toISOString(), page: 1, state: customerState(), answered, addressText: "" });
  assert.equal(decodeResume(suburbOnly, now, { incomingAddress: "9 Elm Street, Bentleigh VIC 3204" }), null);
  assert.ok(decodeResume(suburbOnly, now, { incomingAddress: "14 Murrumbeena Rd, Murrumbeena" }));
});

test("the welcome-back line names the wizard's own page", () => {
  assert.equal(resumeLine(2, "interior"), "you were at Surfaces");
  assert.equal(resumeLine(3, "exterior"), "you were at Scope");
  assert.equal(resumeLine(1, "interior"), "your answers are back");
});
