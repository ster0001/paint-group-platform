import { test } from "vitest";
import assert from "node:assert/strict";
import { recipientsFor } from "./notify.ts";

const staff = [
  { id: "a", name: "Ava", phone: "0412 345 678", email: "ava@x.com", staff_notify: { office_invoice_paid: ["email", "sms"] } },
  { id: "b", name: "Ben", phone: null, email: "ben@x.com", staff_notify: { office_invoice_paid: ["email", "sms"], office_job_declined: ["sms"] } },
  { id: "c", name: "Cy", phone: "+61400000000", email: null, staff_notify: { office_invoice_paid: ["email"] } },
  { id: "d", name: "Di", phone: "12", email: "di@x.com", staff_notify: {} },
];

test("recipientsFor: one entry per person per wanted channel; no phone = no text, no email = no email", () => {
  const r = recipientsFor(staff, "office_invoice_paid");
  assert.deepEqual(r, [
    { profileId: "a", channel: "email", to: "ava@x.com" },
    { profileId: "a", channel: "sms", to: "+61412345678" },
    { profileId: "b", channel: "email", to: "ben@x.com" },
  ]);
});

test("recipientsFor: an address already told elsewhere is skipped, case-insensitively", () => {
  const r = recipientsFor(staff, "office_invoice_paid", ["AVA@x.com"]);
  assert.deepEqual(r.map((x) => `${x.profileId}:${x.channel}`), ["a:sms", "b:email"]);
});

test("recipientsFor: an event nobody asked for reaches nobody; a bad phone shape is dropped", () => {
  assert.deepEqual(recipientsFor(staff, "office_contractor_invoice"), []);
  assert.deepEqual(recipientsFor(staff, "office_job_declined"), []); // Ben wants a text but has no phone
});
