import { test, expect } from "vitest";
import { planQaInvites, qaInviteUid, type QaInviteCheck, type QaInviteEvent } from "./qaCheckInvite";
import { buildIcs } from "./ics";

/**
 * Felipe's calendar invite (Tom, 8 Oct 2026: "go into Felipe's calendar as a
 * calendar request"). The plan is pure: what to send for each check given
 * what was already sent. One UID per check; SEQUENCE climbs per SENT invite;
 * a check taken off the books gets a CANCEL; nothing changed = nothing sent.
 */
const NOW = new Date("2026-10-08T03:00:00Z");
const check = (over: Partial<QaInviteCheck> = {}): QaInviteCheck =>
  ({ id: "c1", kind: "final", date: "2026-10-14", time: "09:00", open: true, ...over });
const sent = (over: Partial<QaInviteEvent> = {}): QaInviteEvent => ({
  checkId: "c1", kind: "final", method: "REQUEST", date: "2026-10-14", time: "09:00", outcome: "sent",
  hash: "REQUEST:2026-10-14:09:00:p1", createdAt: "2026-10-07T00:00:00Z", ...over,
});

test("a newly dated check sends a REQUEST at sequence 0", () => {
  const plan = planQaInvites([check()], [], "p1", NOW);
  expect(plan).toEqual([{ checkId: "c1", kind: "final", method: "REQUEST", date: "2026-10-14", time: "09:00", sequence: 0, hash: "REQUEST:2026-10-14:09:00:p1" }]);
});

test("unchanged = nothing; moved = an update with the next sequence", () => {
  expect(planQaInvites([check()], [sent()], "p1", NOW)).toEqual([]);
  const moved = planQaInvites([check({ date: "2026-10-16" })], [sent()], "p1", NOW);
  expect(moved).toHaveLength(1);
  expect(moved[0]).toMatchObject({ method: "REQUEST", date: "2026-10-16", sequence: 1 });
});

test("an undated check sends nothing until it has a date", () => {
  expect(planQaInvites([check({ date: null, time: null })], [], "p1", NOW)).toEqual([]);
});

test("a check removed (waived) or cleared after an invite went out is CANCELLED at the dates last sent", () => {
  const cancel = planQaInvites([], [sent()], "p1", NOW);
  expect(cancel).toEqual([{ checkId: "c1", kind: "final", method: "CANCEL", date: "2026-10-14", time: "09:00", sequence: 1, hash: "CANCEL:2026-10-14:09:00:p1" }]);
  // …and only once.
  expect(planQaInvites([], [sent(), sent({ method: "CANCEL", hash: "CANCEL:2026-10-14:09:00:p1", createdAt: "2026-10-08T00:00:00Z" })], "p1", NOW)).toEqual([]);
  // A check that never reached anyone needs no cancel.
  expect(planQaInvites([], [], "p1", NOW)).toEqual([]);
  expect(planQaInvites([], [sent({ outcome: "nobody" })], "p1", NOW)).toEqual([]);
});

test("a recorded check keeps its calendar entry — the visit happened", () => {
  expect(planQaInvites([check({ open: false })], [sent()], "p1", NOW)).toEqual([]);
});

test("ticking someone new for the invite re-sends the current state to everyone ticked", () => {
  const plan = planQaInvites([check()], [sent({ outcome: "nobody", hash: "REQUEST:2026-10-14:09:00:" })], "p1", NOW);
  expect(plan).toHaveLength(1);
  expect(plan[0].sequence).toBe(0); // nothing had been SENT yet
});

test("a failed send is retried, but not more than once an hour", () => {
  const failedRecently = sent({ outcome: "error", createdAt: "2026-10-08T02:30:00Z" });
  expect(planQaInvites([check()], [failedRecently], "p1", NOW)).toEqual([]);
  const failedLongAgo = sent({ outcome: "error", createdAt: "2026-10-08T01:00:00Z" });
  expect(planQaInvites([check()], [failedLongAgo], "p1", NOW)).toHaveLength(1);
});

test("the invite is a Melbourne wall-clock entry with a stable UID — a DST day stays 09:00", () => {
  const ics = buildIcs({
    uid: qaInviteUid("c1"), sequence: 2, method: "REQUEST", summary: "Quality check — 1 Test St",
    date: "2026-10-05", time: "09:00", durationMinutes: 60,
    organizerEmail: "office@example.com", organizerName: "Paint Group",
    attendeeEmail: "qa@example.com", attendeeName: "QA", now: NOW,
  });
  expect(ics).toContain("UID:qa-check-c1@paintgroup");
  expect(ics).toContain("SEQUENCE:2");
  expect(ics).toContain("METHOD:REQUEST");
  expect(ics).toContain("DTSTART;TZID=Australia/Melbourne:20261005T090000");
  expect(ics).toContain("DTEND;TZID=Australia/Melbourne:20261005T100000");
});
