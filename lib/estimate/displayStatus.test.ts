import { test } from "vitest";
import assert from "node:assert/strict";
import { displayStatus, filterQuery } from "./displayStatus.ts";

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
