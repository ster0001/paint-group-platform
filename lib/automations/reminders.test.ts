import { test } from "vitest";
import assert from "node:assert/strict";
import { dueRungs } from "./reminders.ts";

const rungs = [{ id: "+14d", afterHours: 14 * 24 }, { id: "+1d", afterHours: 24 }, { id: "+4d", afterHours: 96 }, { id: "+7d", afterHours: 168 }];
const due = new Date("2026-10-02T00:00:00Z");

test("rungs come due in order, only once their hour has passed", () => {
  assert.deepEqual(dueRungs(due, rungs, new Date("2026-10-02T23:00:00Z")).map((r) => r.id), []);
  assert.deepEqual(dueRungs(due, rungs, new Date("2026-10-03T00:00:00Z")).map((r) => r.id), ["+1d"]);
  assert.deepEqual(dueRungs(due, rungs, new Date("2026-10-10T00:00:00Z")).map((r) => r.id), ["+1d", "+4d", "+7d"]);
  assert.deepEqual(dueRungs(due, rungs, new Date("2027-01-01T00:00:00Z")).map((r) => r.id), ["+1d", "+4d", "+7d", "+14d"]);
});
