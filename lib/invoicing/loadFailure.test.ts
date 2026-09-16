import { test } from "vitest";
import assert from "node:assert/strict";
import { loadFailure, paymentsFailure, firstFailure } from "./loadFailure";

/**
 * The regression this encodes: a rejected read must never reach a money screen
 * as a fact. See loadFailure.ts for the 16 Sep 2026 incident.
 */

const MISSING = { code: "42703", message: "column invoices.chase_hold_reason does not exist" };

test("a missing column names the real cause — the database being behind the app", () => {
  const f = loadFailure(MISSING);
  assert.ok(f, "a rejected select must produce a failure, never null");
  assert.match(f.detail, /database is behind the app/i);
  assert.match(f.detail, /migration/i, "staff are told what to do about it");
});

test("the invoice headline denies the empty ledger the screen would otherwise imply", () => {
  const f = loadFailure(MISSING)!;
  assert.match(f.headline, /not an empty ledger/i);
  assert.match(f.detail, /nothing has been lost/i);
});

test("the column-missing wording is reached by message alone, with no code", () => {
  const f = loadFailure({ message: "column invoices.chase_hold_reason does not exist" })!;
  assert.match(f.detail, /database is behind the app/i);
});

test("any other failure is passed through, not swallowed and not disguised", () => {
  const f = loadFailure({ code: "57014", message: "canceling statement due to statement timeout" })!;
  assert.match(f.detail, /canceling statement due to statement timeout/);
});

test("a failure with no message still says something", () => {
  assert.match(loadFailure({ code: "08006" })!.detail, /refused/i);
});

test("a successful read reports no failure — the empty state stays honest", () => {
  assert.equal(loadFailure(null), null);
  assert.equal(paymentsFailure(null), null);
});

/**
 * The payments case is the dangerous one: the invoices all arrive, so the
 * screen looks entirely normal while every balance is wrong.
 */
test("an unread payments table warns that PAID invoices are showing as unpaid", () => {
  const f = paymentsFailure(MISSING);
  assert.ok(f);
  assert.match(f.headline, /every amount on this screen as wrong/i);
  assert.match(f.detail, /paid/i);
  assert.match(f.detail, /do not chase anyone/i, "the operational instruction is the point");
});

test("the payments warning carries the cause too", () => {
  assert.match(paymentsFailure(MISSING)!.detail, /database is behind the app/i);
});

test("payments outrank invoices: the wrong-number lie is likelier to be believed", () => {
  const both = firstFailure(paymentsFailure(MISSING), loadFailure(MISSING))!;
  assert.match(both.headline, /every amount on this screen as wrong/i);
});

test("firstFailure is null when every read succeeded", () => {
  assert.equal(firstFailure(null, null), null);
});

test("firstFailure falls through to the invoice failure when payments were fine", () => {
  const f = firstFailure(paymentsFailure(null), loadFailure(MISSING))!;
  assert.match(f.headline, /not an empty ledger/i);
});
