import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_EVENTS, parseStaffNotify, wantsChannel } from "./notifyEvents.ts";
import { AUTOMATIONS } from "@/lib/automations/registry";

test("every staff event is a registered office automation with a switch", () => {
  for (const e of STAFF_EVENTS) {
    const a = AUTOMATIONS.find((x) => x.key === e.key);
    assert.ok(a, `${e.key} missing from the registry`);
    assert.equal(a!.audience, "office", `${e.key} is not an office automation`);
    assert.equal(a!.kind, "automatic", `${e.key} has no on/off switch`);
  }
});

test("parseStaffNotify keeps only known keys and known channels, de-duplicated", () => {
  assert.deepEqual(parseStaffNotify(null), {});
  assert.deepEqual(parseStaffNotify([]), {});
  assert.deepEqual(parseStaffNotify("x"), {});
  assert.deepEqual(
    parseStaffNotify({ office_invoice_paid: ["email", "sms", "email", "fax"], office_made_up: ["email"], office_job_declined: "email", office_job_accepted: [] }),
    { office_invoice_paid: ["email", "sms"] },
  );
});

test("wantsChannel reads the map; a missing key means nobody is told", () => {
  const m = parseStaffNotify({ office_job_declined: ["sms"] });
  assert.equal(wantsChannel(m, "office_job_declined", "sms"), true);
  assert.equal(wantsChannel(m, "office_job_declined", "email"), false);
  assert.equal(wantsChannel(m, "office_invoice_paid", "email"), false);
});
