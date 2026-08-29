import { describe, expect, it } from "vitest";
import { isWon, needsYouToday, stageFor, THRESHOLDS, type AccountFacts } from "./stage";

const NOW = new Date("2026-08-29T10:00:00+10:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const facts = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  estimates: [],
  workOrders: [],
  events: [],
  temperature: null,
  snoozedUntil: null,
  followupDueAt: null,
  ...over,
});

const estimate = (over: Partial<AccountFacts["estimates"][number]> = {}) => ({
  id: "e1", status: "draft", total_cents: 500_000,
  created_at: daysAgo(10), sent_at: null, viewed_at: null,
  accepted_at: null, declined_at: null,
  ...over,
});

describe("stageFor — the lane comes from the facts, never from a column", () => {
  it("an estimate started and never sent is an unfinished enquiry", () => {
    const r = stageFor(facts({ estimates: [estimate({ created_at: daysAgo(2) })] }), NOW);
    expect(r.stage).toBe("enquiry_unfinished");
    expect(r.because).toBe("Estimate started · 2d");
  });

  it("a customer with nothing at all is still an unfinished enquiry, not a crash", () => {
    expect(stageFor(facts(), NOW).stage).toBe("enquiry_unfinished");
  });

  it("a sent estimate reads as sent, and says whether it was opened", () => {
    const unopened = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(1) })],
    }), NOW);
    expect(unopened.stage).toBe("estimate_sent");
    expect(unopened.because).toBe("Not opened · 1d");

    const opened = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(4), viewed_at: daysAgo(3) })],
      events: [
        { type: "estimate_viewed", occurred_at: daysAgo(3) },
        { type: "estimate_viewed", occurred_at: daysAgo(2) },
        { type: "estimate_viewed", occurred_at: daysAgo(1) },
      ],
    }), NOW);
    expect(opened.because).toBe("Opened 3× · 4d");
  });

  it("chases an unopened estimate sooner than an opened one", () => {
    const unopened = (d: number) => stageFor(facts({ estimates: [estimate({ status: "sent", sent_at: daysAgo(d) })] }), NOW);
    expect(unopened(THRESHOLDS.chaseUnopenedDays - 1).flags.chaseDue).toBe(false);
    expect(unopened(THRESHOLDS.chaseUnopenedDays).flags.chaseDue).toBe(true);

    const opened = (d: number) => stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(d), viewed_at: daysAgo(d) })],
    }), NOW);
    // Someone who has read it is not chased on day 3 — they are thinking.
    expect(opened(THRESHOLDS.chaseUnopenedDays).flags.chaseDue).toBe(false);
    expect(opened(THRESHOLDS.chaseOpenedDays).flags.chaseDue).toBe(true);
  });

  it("a booked visit outranks the estimate that led to it", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(9) })],
      events: [{ type: "visit_booked", occurred_at: daysAgo(1) }],
    }), NOW);
    expect(r.stage).toBe("visit_booked");
  });

  it("a completed visit with no answer becomes its own lane, and asks for a second attempt", () => {
    const quiet = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(20) })],
      events: [
        { type: "visit_booked", occurred_at: daysAgo(12) },
        { type: "visit_completed", occurred_at: daysAgo(9) },
      ],
    }), NOW);
    expect(quiet.stage).toBe("visit_done_no_reply");
    expect(quiet.because).toBe("9 days silent");
    expect(quiet.flags.secondAttemptDue).toBe(true);

    const fresh = stageFor(facts({
      events: [{ type: "visit_completed", occurred_at: daysAgo(1) }],
    }), NOW);
    expect(fresh.flags.secondAttemptDue).toBe(false);
  });

  it("a revised estimate is a negotiation, and counts the revisions", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(6) })],
      events: [{ type: "estimate_revised", occurred_at: daysAgo(1) }],
    }), NOW);
    expect(r.stage).toBe("negotiating");
    expect(r.because).toBe("Revision 2 sent");
  });

  it("a job in flight beats every earlier lane", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "accepted", accepted_at: daysAgo(6) })],
      events: [{ type: "visit_completed", occurred_at: daysAgo(20) }],
      workOrders: [{ status: "in_progress", start_date: daysAgo(2), end_date: daysAgo(-2) }],
    }), NOW);
    expect(r.stage).toBe("job_on");
    expect(r.because).toBe("Day 3 of 5");
  });

  it("accepted but not booked in is still live work, not a past customer", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "accepted", accepted_at: daysAgo(3) })],
    }), NOW);
    expect(r.stage).toBe("job_on");
    expect(r.because).toBe("Accepted — not booked in");
  });

  it("becomes a past customer only once the job is properly behind them", () => {
    const justDone = stageFor(facts({
      workOrders: [{ status: "complete", start_date: daysAgo(20), end_date: daysAgo(5) }],
      estimates: [estimate({ status: "accepted", accepted_at: daysAgo(25) })],
    }), NOW);
    expect(justDone.stage).toBe("job_on");

    const longDone = stageFor(facts({
      workOrders: [{ status: "complete", start_date: daysAgo(400), end_date: daysAgo(380) }],
      estimates: [estimate({ status: "accepted", accepted_at: daysAgo(410) })],
    }), NOW);
    expect(longDone.stage).toBe("past_customer");
    expect(longDone.because).toMatch(/year/);
  });

  it("a declined quote with nothing else open is lost, not filed somewhere untrue", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "declined", declined_at: daysAgo(4), sent_at: daysAgo(10) })],
    }), NOW);
    expect(r.stage).toBe("lost");
  });

  it("a live job outranks an old declined quote", () => {
    const r = stageFor(facts({
      estimates: [
        estimate({ id: "old", status: "declined", declined_at: daysAgo(200) }),
        estimate({ id: "new", status: "accepted", accepted_at: daysAgo(3) }),
      ],
      workOrders: [{ status: "in_progress", start_date: daysAgo(1), end_date: daysAgo(-4) }],
    }), NOW);
    expect(r.stage).toBe("job_on");
  });

  it("goes cold after the threshold, and a finished customer never does", () => {
    const cold = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(THRESHOLDS.goingColdDays + 1) })],
    }), NOW);
    expect(cold.flags.goingCold).toBe(true);

    const past = stageFor(facts({
      workOrders: [{ status: "complete", start_date: daysAgo(400), end_date: daysAgo(380) }],
    }), NOW);
    expect(past.flags.goingCold).toBe(false);
  });

  it("reads a follow-up as overdue only once it is due", () => {
    expect(stageFor(facts({ followupDueAt: daysAgo(1) }), NOW).flags.followupOverdue).toBe(true);
    expect(stageFor(facts({ followupDueAt: daysAgo(-1) }), NOW).flags.followupOverdue).toBe(false);
  });
});

describe("needsYouToday", () => {
  it("a snooze takes the card out of the count", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(30) })],
      snoozedUntil: daysAgo(-7),
    }), NOW);
    expect(r.flags.chaseDue).toBe(true);
    expect(needsYouToday(r)).toBe(false);
  });

  it("an EXPIRED snooze puts it back — the mockup's 'snoozed until yesterday' card", () => {
    const r = stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(30) })],
      snoozedUntil: daysAgo(1),
      followupDueAt: daysAgo(1),
    }), NOW);
    expect(r.flags.snoozed).toBe(false);
    expect(needsYouToday(r)).toBe(true);
  });

  it("a quiet, recent customer wants nothing", () => {
    expect(needsYouToday(stageFor(facts({
      estimates: [estimate({ status: "sent", sent_at: daysAgo(1) })],
    }), NOW))).toBe(false);
  });
});

describe("isWon", () => {
  it("trusts the status, because accepted_at is not always stamped", () => {
    // Live data, 29 Aug 2026: two accepted estimates carry a null accepted_at.
    // Filtering on the timestamp lost both, and told the report that customer
    // had won nothing.
    expect(isWon({ status: "accepted", accepted_at: null })).toBe(true);
    expect(isWon({ status: "sent", accepted_at: "2026-08-01T00:00:00Z" })).toBe(true);
    expect(isWon({ status: "draft", accepted_at: null })).toBe(false);
    expect(isWon({ status: "declined", accepted_at: null })).toBe(false);
  });
});
