import { test } from "vitest";
import assert from "node:assert/strict";
import { dayInstant, depositRungInstants, invoiceChaseable, invoiceRungs } from "./moneySignoff.ts";
import { dueRungs } from "../reminders.ts";
import { melbourneInstant } from "@/lib/time/businessHours";

const base = { status: "issued", due_on: "2026-10-02", total_inc_cents: 120_000, paid_cents: 0, chase_hold_reason: null as string | null };

test("an invoice is chaseable only when open, owing, past due and not on hold", () => {
  const before = melbourneInstant(2026, 10, 2, 9);
  const after = melbourneInstant(2026, 10, 3, 9);
  assert.equal(invoiceChaseable(base, before), false, "due today — not yet");
  assert.equal(invoiceChaseable(base, after), true);
  assert.equal(invoiceChaseable({ ...base, status: "paid" }, after), false);
  assert.equal(invoiceChaseable({ ...base, status: "draft" }, after), false);
  assert.equal(invoiceChaseable({ ...base, paid_cents: 120_000 }, after), false, "a payment clears the ladder");
  assert.equal(invoiceChaseable({ ...base, paid_cents: 50_000 }, after), true, "partly paid still owes");
  assert.equal(invoiceChaseable({ ...base, chase_hold_reason: "Disputed the trim price" }, after), false, "a dispute hold pauses reminders");
});

test("D6: rungs at +1, +4, +7, +14 days after the due date, only the latest due one fires", () => {
  const rungs = invoiceRungs([1, 4, 7, 14]);
  const anchor = dayInstant("2026-10-02");
  assert.deepEqual(dueRungs(anchor, rungs, melbourneInstant(2026, 10, 3, 11)).map((r) => r.id), []);
  assert.deepEqual(dueRungs(anchor, rungs, melbourneInstant(2026, 10, 3, 13)).map((r) => r.id), ["rung1"]);
  assert.deepEqual(dueRungs(anchor, rungs, melbourneInstant(2026, 10, 10, 13)).map((r) => r.id), ["rung1", "rung2", "rung3"]);
});

test("the due-date anchor is midday Melbourne and survives the 4 Oct clock change", () => {
  assert.equal(dayInstant("2026-10-03").toISOString(), "2026-10-03T02:00:00.000Z");   // AEST +10
  assert.equal(dayInstant("2026-10-05").toISOString(), "2026-10-05T01:00:00.000Z");   // AEDT +11
  assert.equal(dayInstant("2026-10-03", 2).toISOString(), "2026-10-05T01:00:00.000Z", "+2 days lands on midday, not 13:00");
});

test("deposit rungs: N days after issue and N days before the start", () => {
  const at = depositRungInstants({ issued_on: "2026-09-20" }, "2026-10-01", 3, 5);
  assert.equal(at.afterIssue?.toISOString(), dayInstant("2026-09-23").toISOString());
  assert.equal(at.beforeStart?.toISOString(), dayInstant("2026-09-26").toISOString());
  assert.equal(depositRungInstants({ issued_on: null }, null, 3, 5).afterIssue, null);
});

// ---- Session 4 (20 Sep 2026): contractor_offer_reminder, D7 ------------------
import { formatOfferExpiry, inOfferReminderWindow, offerReminderRungs, rungToFire, suburbFromAddress } from "./moneySignoff.ts";

test("D7: rungs at 12 h and 20 h after the offer went out; only the latest due one fires, once", () => {
  const rungs = offerReminderRungs(12, 20);
  const offered = melbourneInstant(2026, 9, 21, 9);          // 9 am Mon
  const none = new Set<string>();
  assert.equal(rungToFire(offered, rungs, melbourneInstant(2026, 9, 21, 20, 59), none, "o1"), null, "11h59 — not yet");
  assert.equal(rungToFire(offered, rungs, melbourneInstant(2026, 9, 21, 21), none, "o1")?.id, "first");
  assert.equal(rungToFire(offered, rungs, melbourneInstant(2026, 9, 22, 5), none, "o1")?.id, "second", "20 h on — the second, never the first late");
  assert.equal(rungToFire(offered, rungs, melbourneInstant(2026, 9, 22, 5), new Set(["o1:second"]), "o1"), null, "claimed = fired");
  assert.equal(rungToFire(offered, rungs, melbourneInstant(2026, 9, 21, 21), new Set(["o1:first"]), "o1"), null);
});

test("D7: no offer reminder between 22:00 and 04:59 Melbourne, measured from the zone across the clock change", () => {
  assert.equal(inOfferReminderWindow(melbourneInstant(2026, 9, 21, 21, 59)), true);
  assert.equal(inOfferReminderWindow(melbourneInstant(2026, 9, 21, 22, 0)), false);
  assert.equal(inOfferReminderWindow(melbourneInstant(2026, 9, 22, 4, 59)), false);
  assert.equal(inOfferReminderWindow(melbourneInstant(2026, 9, 22, 5, 0)), true);
  // AEDT (+11) after 4 Oct: 22:00 Melbourne is 11:00Z, not 12:00Z.
  assert.equal(inOfferReminderWindow(new Date("2026-10-10T11:00:00.000Z")), false);
  assert.equal(inOfferReminderWindow(new Date("2026-10-10T10:59:00.000Z")), true);
  assert.equal(inOfferReminderWindow(new Date("2026-10-09T18:00:00.000Z")), true, "5 am AEDT");
  assert.equal(inOfferReminderWindow(new Date("2026-10-09T17:59:00.000Z")), false, "4:59 am AEDT");
});

test("the expiry reads as the painter's phone would show it, in Melbourne time", () => {
  assert.equal(formatOfferExpiry(melbourneInstant(2026, 9, 22, 15, 15)), "3:15 pm Tue 22 Sep");
  assert.equal(formatOfferExpiry(melbourneInstant(2026, 10, 5, 7, 5)), "7:05 am Mon 5 Oct", "after the clock change");
  assert.equal(formatOfferExpiry(melbourneInstant(2026, 9, 23, 0, 0)), "12:00 am Wed 23 Sep");
});

test("the suburb comes out of the snapshot address; the ref stands in when there is none", () => {
  assert.equal(suburbFromAddress("12 Elm Grove, Thornbury VIC 3071", "WO-1"), "Thornbury");
  assert.equal(suburbFromAddress("1 Test St, Melbourne", "WO-1"), "Melbourne");
  assert.equal(suburbFromAddress("25-27 Bunney Rd, Oakleigh South VIC 3167, Australia", "WO-1"), "Oakleigh South");
  assert.equal(suburbFromAddress("Thornbury", "WO-1"), "Thornbury");
  assert.equal(suburbFromAddress("", "WO-1"), "WO-1");
  assert.equal(suburbFromAddress(null, "WO-1"), "WO-1");
});
