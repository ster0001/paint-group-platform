import { test } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_QUIET_HOURS, channelChoicesFor, melbourneDateKey, nextSendingOpen, normaliseChannel, parseQuietHours,
  planChannels, smsLength, unfilledPlaceholders, withinSendingHours,
} from "./controls.ts";
import { melbourneInstant } from "@/lib/time/businessHours";

test("channel choices follow what the automation supports", () => {
  assert.deepEqual(channelChoicesFor(["email", "sms"]), ["both", "email", "sms"]);
  assert.deepEqual(channelChoicesFor(["email", "ics"]), ["email"]);
  assert.deepEqual(channelChoicesFor(["sms"]), ["sms"]);
  assert.equal(normaliseChannel("sms", ["email"], "email"), "email", "an unsupported stored choice is ignored");
  assert.equal(normaliseChannel(undefined, ["email", "sms"], "both"), "both");
});

test("D3: a chosen channel with no contact detail falls back and says so", () => {
  assert.deepEqual(planChannels("sms", ["email", "sms"], { email: "a@b.c", phone: "" }), { channels: ["email"], fallback: "No mobile on file — sent by email instead." });
  assert.deepEqual(planChannels("email", ["email", "sms"], { email: null, phone: "+61400000000" }), { channels: ["sms"], fallback: "No email on file — sent by text instead." });
  assert.deepEqual(planChannels("both", ["email", "sms"], { email: "a@b.c", phone: "+61400000000" }), { channels: ["sms", "email"] });
  assert.deepEqual(planChannels("both", ["email", "sms"], { email: "a@b.c" }), { channels: ["email"] });
  assert.deepEqual(planChannels("sms", ["email", "sms"], {}), { channels: [] });
  assert.deepEqual(planChannels("sms", ["email"], { email: "a@b.c", phone: "+61400000000" }), { channels: ["email"], fallback: "No mobile on file — sent by email instead." }, "text is not supported → email");
});

test("D1 quiet hours: weekdays 8–7, Saturday 9–5, Sunday closed — Melbourne clock", () => {
  // Wed 16 Sep 2026 (AEST, +10)
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 16, 7, 59)), false);
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 16, 8, 0)), true);
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 16, 18, 59)), true);
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 16, 19, 0)), false);
  // Sat 19 Sep
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 19, 8, 30)), false);
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 19, 12, 0)), true);
  // Sun 20 Sep — never
  assert.equal(withinSendingHours(melbourneInstant(2026, 9, 20, 12, 0)), false);
});

test("a held message is released at the next opening, across the weekend and the DST change", () => {
  // Wed 16 Sep 21:00 → Thu 17 Sep 08:00
  assert.equal(nextSendingOpen(melbourneInstant(2026, 9, 16, 21)).getTime(), melbourneInstant(2026, 9, 17, 8).getTime());
  // Sat 19 Sep 18:00 → Mon 21 Sep 08:00 (Sunday skipped)
  assert.equal(nextSendingOpen(melbourneInstant(2026, 9, 19, 18)).getTime(), melbourneInstant(2026, 9, 21, 8).getTime());
  // Inside the window: unchanged
  const inside = melbourneInstant(2026, 9, 16, 10);
  assert.equal(nextSendingOpen(inside).getTime(), inside.getTime());
  // DST starts Sun 4 Oct 2026: Sat 3 Oct 20:00 (+10) → Mon 5 Oct 08:00 (+11). 8am Melbourne is 21:00Z, not 22:00Z.
  const mon = nextSendingOpen(melbourneInstant(2026, 10, 3, 20));
  assert.equal(mon.toISOString(), "2026-10-04T21:00:00.000Z");
  // A Sunday-only-closed config with everything else null cannot spin.
  const allClosed = parseQuietHours({ weekday: null, saturday: null, sunday: null });
  const at = melbourneInstant(2026, 9, 16, 10);
  assert.equal(nextSendingOpen(at, allClosed).getTime(), at.getTime());
});

test("stored quiet hours are read defensively", () => {
  assert.deepEqual(parseQuietHours(null), DEFAULT_QUIET_HOURS);
  assert.deepEqual(parseQuietHours({ weekday: [9, 17], saturday: "nope", sunday: null }), { weekday: [9, 17], saturday: [9, 17], sunday: null });
  assert.deepEqual(parseQuietHours({ weekday: [19, 8] }), DEFAULT_QUIET_HOURS, "open after close is ignored");
});

test("the Melbourne date key never slips a day before 10am", () => {
  // 2026-09-16 08:00 Melbourne = 2026-09-15T22:00Z
  assert.equal(melbourneDateKey(new Date("2026-09-15T22:00:00Z")), "2026-09-16");
});

test("SMS parts: GSM-7 at 160/153, Unicode at 70/67, extension chars cost two", () => {
  assert.deepEqual(smsLength(""), { chars: 0, encoding: "GSM-7", parts: 0, perPart: 160 });
  assert.equal(smsLength("a".repeat(160)).parts, 1);
  assert.equal(smsLength("a".repeat(161)).parts, 2);
  assert.equal(smsLength("a".repeat(306)).parts, 2);
  assert.equal(smsLength("a".repeat(307)).parts, 3);
  assert.equal(smsLength("{}").chars, 4);
  const u = smsLength("Hello — dash");   // em dash is not GSM
  assert.equal(u.encoding, "Unicode");
  assert.equal(smsLength("x".repeat(60) + "—").parts, 1);
  assert.equal(smsLength("x".repeat(70) + "—").parts, 2);
});

test("preview reports placeholders it cannot fill", () => {
  assert.deepEqual(unfilledPlaceholders("Hi {{first_name}}, {{nonsense}} and {{link}}"), ["nonsense"]);
});
