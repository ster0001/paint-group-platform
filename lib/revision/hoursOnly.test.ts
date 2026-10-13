import { test } from "vitest";
import assert from "node:assert/strict";
import { revisionCredit } from "./hoursOnly";
import { notInSheet, scopeChangesFrom } from "../workorder/scopeChanges";

test("fewer contractor hours at the same customer price is a credit to the painter", () => {
  assert.equal(revisionCredit(0, -4), true);
  assert.equal(revisionCredit(0, 4), false);
  assert.equal(revisionCredit(-100, 4), true);
  assert.equal(revisionCredit(100, -4), false);
});

test("a change folded into the sheet before the painter had the job is not listed", () => {
  const rows = [
    { id: "a", category: "extra_scope", comment: "Garage — added", est_hours: 6, status: "contractor_accepted", in_sheet_at: "2026-10-12T01:00:00Z" },
    { id: "b", category: "extra_scope", comment: "Hall — added", est_hours: 2, status: "contractor_accepted", in_sheet_at: null },
  ];
  assert.deepEqual(scopeChangesFrom(rows).map((c) => c.id), ["b"]);
  assert.deepEqual(rows.filter(notInSheet).map((r) => r.id), ["b"]);
});
