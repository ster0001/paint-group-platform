import { test, expect } from "vitest";
import { openQaChecks, qaAllClear, supersededQaIds } from "./qa";

/**
 * The 6 Sep 2026 gap: a failed check counted as open for ever, so a job that
 * failed once could never reach Walkthrough through the screens. The rule now
 * mirrors wo_qa_open_count: a fail is open until its re-check exists, and the
 * re-check carries the openness from there.
 */

const fail = { id: "f1", result: "fail", retryOf: null };
const recheckPending = { id: "r1", result: null, retryOf: "f1" };
const recheckPassed = { id: "r1", result: "pass", retryOf: "f1" };
const recheckFailed = { id: "r1", result: "fail", retryOf: "f1" };
const recheck2Passed = { id: "r2", result: "pass", retryOf: "r1" };

test("an unlogged check is open", () => {
  expect(openQaChecks([{ id: "a", result: null }]).map((c) => c.id)).toEqual(["a"]);
  expect(qaAllClear([{ id: "a", result: null }])).toBe(false);
});

test("a fail with no re-check is open — the parked state", () => {
  expect(openQaChecks([fail]).map((c) => c.id)).toEqual(["f1"]);
  expect(qaAllClear([fail])).toBe(false);
});

test("a fail with a pending re-check hands its openness to the re-check", () => {
  const open = openQaChecks([fail, recheckPending]);
  expect(open.map((c) => c.id)).toEqual(["r1"]);
  expect(supersededQaIds([fail, recheckPending]).has("f1")).toBe(true);
  expect(qaAllClear([fail, recheckPending])).toBe(false);
});

test("a fail whose re-check passed is settled — the job can move on", () => {
  expect(openQaChecks([fail, recheckPassed])).toEqual([]);
  expect(qaAllClear([fail, recheckPassed])).toBe(true);
});

test("a re-check that fails again is open until ITS re-check passes", () => {
  expect(openQaChecks([fail, recheckFailed]).map((c) => c.id)).toEqual(["r1"]);
  expect(qaAllClear([fail, recheckFailed, recheck2Passed])).toBe(true);
});

test("no checks at all is not 'all clear' — routing needs at least one", () => {
  expect(qaAllClear([])).toBe(false);
});

test("order of rows does not matter", () => {
  expect(qaAllClear([recheckPassed, fail])).toBe(true);
  expect(openQaChecks([recheckPending, fail]).map((c) => c.id)).toEqual(["r1"]);
});
