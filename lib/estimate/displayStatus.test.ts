import { test } from "vitest";
import assert from "node:assert/strict";
import { displayStatus, filterQuery, LIST_FILTERS } from "./displayStatus.ts";

test("a sent estimate the customer has opened shows as viewed", () => {
  assert.equal(displayStatus({ status: "sent", viewed_at: "2026-09-04T01:00:00Z" }), "viewed");
  assert.equal(displayStatus({ status: "sent", viewed_at: null }), "sent");
  assert.equal(displayStatus({ status: "sent" }), "sent");
});

test("every other status is shown as it is — a viewed then accepted estimate is accepted", () => {
  assert.equal(displayStatus({ status: "accepted", viewed_at: "2026-09-04T01:00:00Z" }), "accepted");
  assert.equal(displayStatus({ status: "draft", viewed_at: null }), "draft");
  assert.equal(displayStatus({ status: "declined", viewed_at: "x" }), "declined");
});

test("the Sent and Viewed tabs split one DB status by viewed_at", () => {
  assert.deepEqual(filterQuery("sent"), { status: "sent", viewed: false });
  assert.deepEqual(filterQuery("viewed"), { status: "sent", viewed: true });
  assert.deepEqual(filterQuery("accepted"), { status: "accepted" });
  assert.deepEqual(filterQuery("all"), {});
  assert.deepEqual(filterQuery(undefined), {});
});

test("C7b: the waiting tab is FIRST, so it is the page's default", () => {
  assert.equal(LIST_FILTERS[0], "waiting");
});

test("C7b: waiting never becomes a status filter", () => {
  // `.eq("status", "waiting")` would match nothing and read as an empty inbox
  // rather than a bug — the rows come from lib/crm/work-queue.ts, the same
  // evaluator CRM Today reads.
  assert.deepEqual(filterQuery("waiting"), {});
});

test("C7b: the existing tabs are untouched", () => {
  assert.deepEqual(filterQuery("sent"), { status: "sent", viewed: false });
  assert.deepEqual(filterQuery("viewed"), { status: "sent", viewed: true });
  assert.deepEqual(filterQuery("draft"), { status: "draft" });
  assert.deepEqual(filterQuery("all"), {});
});
