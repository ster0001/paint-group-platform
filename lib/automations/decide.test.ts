import { test } from "vitest";
import assert from "node:assert/strict";
import { decide, modeFor, timingFor, type Decision } from "./decide.ts";
const ch = (d: Decision) => ("channels" in d ? d.channels : null);
import type { Automation } from "./registry.ts";
import { melbourneInstant } from "@/lib/time/businessHours";

const base: Automation = {
  key: "t_job", name: "Test", audience: "customer", channels: ["email", "sms"], kind: "automatic", trigger: "",
  defaultChannel: "both", approvable: true, defaultMode: "auto", sendKind: "job", timing: [{ id: "daysBefore", label: "Days before", unit: "days", default: 2 }],
};
const contact = { email: "s@example.org", phone: "+61400000000" };
const inHours = melbourneInstant(2026, 9, 16, 10);   // Wed 10:00
const atNight = melbourneInstant(2026, 9, 16, 22);   // Wed 22:00

test("off wins over everything", () => {
  assert.deepEqual(decide({ automation: base, cfg: { disabled: ["t_job"] }, contact, now: inHours, sentToday: 0 }), { action: "off" });
});

test("default settings send now on every supported channel", () => {
  assert.deepEqual(decide({ automation: base, cfg: {}, contact, now: inHours, sentToday: 0 }), { action: "send", channels: ["sms", "email"], fallback: undefined });
});

test("Text-only means no email; Email-only means no text; a stored choice the automation cannot do is ignored", () => {
  assert.deepEqual(ch(decide({ automation: base, cfg: { controls: { t_job: { channel: "sms" } } }, contact, now: inHours, sentToday: 0 })), ["sms"]);
  assert.deepEqual(ch(decide({ automation: base, cfg: { controls: { t_job: { channel: "email" } } }, contact, now: inHours, sentToday: 0 })), ["email"]);
  const emailOnly: Automation = { ...base, channels: ["email"], defaultChannel: "email" };
  assert.deepEqual(ch(decide({ automation: emailOnly, cfg: { controls: { t_job: { channel: "sms" } } }, contact, now: inHours, sentToday: 0 })), ["email"]);
});

test("D3: no mobile with Text chosen falls back to email and says so", () => {
  const d = decide({ automation: base, cfg: { controls: { t_job: { channel: "sms" } } }, contact: { email: "s@example.org" }, now: inHours, sentToday: 0 });
  assert.equal(d.action, "send");
  assert.deepEqual(d.channels, ["email"]);
  assert.match(d.fallback ?? "", /No mobile on file/);
  assert.equal(decide({ automation: base, cfg: {}, contact: {}, now: inHours, sentToday: 0 }).action, "nobody");
});

test("office approves first → pending, before quiet hours or the cap are even asked", () => {
  const d = decide({ automation: base, cfg: { controls: { t_job: { mode: "approve" } } }, contact, now: atNight, sentToday: 9 });
  assert.equal(d.action, "pending");
  // Not approvable → never pending, whatever is stored.
  const fixed: Automation = { ...base, approvable: false };
  assert.equal(modeFor(fixed, { controls: { t_job: { mode: "approve" } } }), "auto");
});

test("D1: quiet hours hold an automatic customer message until the next opening; exempt kinds and office alerts pass", () => {
  const d = decide({ automation: base, cfg: {}, contact, now: atNight, sentToday: 0 });
  assert.equal(d.action, "hold");
  if (d.action !== "hold") return;
  assert.equal(d.reason, "quiet");
  assert.equal(d.releaseAt.getTime(), melbourneInstant(2026, 9, 17, 8).getTime());
  const exempt: Automation = { ...base, quietExempt: true };
  assert.equal(decide({ automation: exempt, cfg: {}, contact, now: atNight, sentToday: 0 }).action, "send");
  const office: Automation = { ...base, audience: "office" };
  assert.equal(decide({ automation: office, cfg: {}, contact, now: atNight, sentToday: 0 }).action, "send");
  // A release of a held message never re-asks.
  assert.equal(decide({ automation: base, cfg: {}, contact, now: atNight, sentToday: 9, direct: true }).action, "send");
});

test("D2: the third message today is fine, the fourth is held for tomorrow's opening; exempt kinds and painters pass", () => {
  assert.equal(decide({ automation: base, cfg: {}, contact, now: inHours, sentToday: 2 }).action, "send");
  const d = decide({ automation: base, cfg: {}, contact, now: inHours, sentToday: 3 });
  assert.equal(d.action, "hold");
  if (d.action !== "hold") return;
  assert.equal(d.reason, "cap");
  assert.equal(d.releaseAt.getTime(), melbourneInstant(2026, 9, 17, 8).getTime());
  assert.match(d.detail, /limit 3/);
  assert.equal(decide({ automation: base, cfg: { dailyCap: 5 }, contact, now: inHours, sentToday: 3 }).action, "send");
  const exempt: Automation = { ...base, capExempt: true };
  assert.equal(decide({ automation: exempt, cfg: {}, contact, now: inHours, sentToday: 3 }).action, "send");
  const painter: Automation = { ...base, audience: "painter" };
  assert.equal(decide({ automation: painter, cfg: {}, contact, now: inHours, sentToday: 3 }).action, "send");
  // A Saturday-evening cap hold lands Monday 08:00 (Sunday closed).
  const sat = melbourneInstant(2026, 9, 19, 12);
  const w = decide({ automation: base, cfg: {}, contact, now: sat, sentToday: 3 });
  assert.equal(w.action === "hold" && w.releaseAt.getTime(), melbourneInstant(2026, 9, 21, 8).getTime());
});

test("timing reads the stored number, else the registry default", () => {
  assert.equal(timingFor(base, {}, "daysBefore"), 2);
  assert.equal(timingFor(base, { controls: { t_job: { timing: { daysBefore: 5 } } } }, "daysBefore"), 5);
  assert.equal(timingFor(base, { controls: { t_job: { timing: { daysBefore: Number.NaN } } } }, "daysBefore"), 2);
});
