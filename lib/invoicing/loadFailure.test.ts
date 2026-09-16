import { test } from "vitest";
import assert from "node:assert/strict";
import { loadFailure } from "./loadFailure";

/**
 * The regression this encodes: a rejected invoice select must never reach the
 * screen as "no invoices". See loadFailure.ts for the 16 Sep 2026 incident.
 */

test("a missing column names the real cause — the database being behind the app", () => {
  const msg = loadFailure({ code: "42703", message: "column invoices.chase_hold_reason does not exist" });
  assert.ok(msg, "a rejected select must produce a message, never null");
  assert.match(msg, /database is behind the app/i);
  assert.match(msg, /migration/i, "staff are told what to do about it");
});

test("the column-missing wording is reached by message alone, with no code", () => {
  const msg = loadFailure({ message: "column invoices.chase_hold_reason does not exist" });
  assert.match(msg!, /database is behind the app/i);
});

test("any other failure is passed through, not swallowed and not disguised", () => {
  assert.equal(
    loadFailure({ code: "57014", message: "canceling statement due to statement timeout" }),
    "canceling statement due to statement timeout",
  );
});

test("a failure with no message still says something", () => {
  assert.equal(loadFailure({ code: "08006" }), "The invoices could not be read just now.");
});

test("a successful read reports no failure — the empty state stays honest", () => {
  assert.equal(loadFailure(null), null);
});
