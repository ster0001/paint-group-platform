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
