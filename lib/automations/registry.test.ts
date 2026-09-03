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
