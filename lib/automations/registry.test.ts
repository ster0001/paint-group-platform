import { test } from "vitest";
import assert from "node:assert/strict";
import { AUTOMATIONS } from "./registry.ts";
import { DEFAULT_MESSAGING, automationOn } from "@/lib/messaging/config";

test("every registry key is unique and every template field exists on the settings shape", () => {
  const keys = AUTOMATIONS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate automation key");
  for (const a of AUTOMATIONS) {
    for (const t of a.templates ?? []) {
      assert.ok(t.field in DEFAULT_MESSAGING, `${a.key}: template field ${String(t.field)} has no default`);
    }
  }
});

test("an automatic one without a template field still says where its wording lives", () => {
  for (const a of AUTOMATIONS.filter((x) => x.kind === "automatic" && !x.special)) {
    assert.ok((a.templates?.length ?? 0) > 0 || a.wording, `${a.key}: no wording and no template`);
  }
});

test("absent from the disabled list means ON; a malformed list never switches anything off", () => {
  assert.equal(automationOn({}, "contractor_offer"), true);
  assert.equal(automationOn({ disabled: ["contractor_offer"] }, "contractor_offer"), false);
  assert.equal(automationOn({ disabled: ["contractor_offer"] }, "contractor_qa_fail"), true);
  assert.equal(automationOn({ disabled: "nope" as unknown as string[] }, "contractor_offer"), true);
  assert.equal(automationOn(null, "contractor_offer"), true);
});

test("every default template that carries a link keeps its {{link}}", () => {
  for (const f of ["offerSms", "variationReleasedSms", "qaFailSms", "chatReplySms"] as const) {
    assert.ok(DEFAULT_MESSAGING[f].includes("{{link}}"), `${f} lost its link`);
  }
});

// ---- Session 1 (16 Sep 2026): channel / mode / timing controls -------------
import { SAMPLE_VARS, channelChoicesFor } from "./controls.ts";

test("a default channel is one the automation supports; an approvable one says what ships", () => {
  for (const a of AUTOMATIONS) {
    if (a.defaultChannel) {
      assert.ok(channelChoicesFor(a.channels).includes(a.defaultChannel), `${a.key}: default channel ${a.defaultChannel} not among ${a.channels.join(",")}`);
    }
    if (a.approvable) assert.ok(a.defaultMode, `${a.key}: approvable without a default mode`);
    if (a.kind === "automatic" && a.channels.length > 0 && !a.special) {
      assert.ok(a.defaultChannel, `${a.key}: an automatic message needs a default channel`);
      assert.ok(a.sendKind, `${a.key}: an automatic message needs a sendKind for the customer's alert settings`);
    }
  }
});

test("every placeholder any template lists has an example value, so the preview never shows a raw token", () => {
  for (const a of AUTOMATIONS) {
    for (const t of a.templates ?? []) {
      for (const ph of t.placeholders ?? []) {
        const name = ph.replace(/[{}]/g, "");
        assert.ok(name in SAMPLE_VARS, `${a.key}.${String(t.field)}: no example for ${ph}`);
      }
    }
  }
});

test("the three sends brought onto the list in Session 1 are there", () => {
  for (const k of ["tenant_access_text", "crm_record_reply", "contractor_gcal_push"]) assert.ok(AUTOMATIONS.some((a) => a.key === k), k);
  for (const k of ["office_job_accepted", "office_job_declined", "office_invoice_paid", "office_variation_raised", "office_contractor_invoice"]) {
    assert.ok((AUTOMATIONS.find((a) => a.key === k)?.templates?.length ?? 0) === 2, `${k}: office wording must be editable`);
  }
});
