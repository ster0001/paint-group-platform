import { describe, expect, it } from "vitest";
import {
  criteriaSchema, evaluateSegment, previewSegment, STANDING_SEGMENTS, toSubject,
  type Segment, type SegmentSubject,
} from "./segments";

const NOW = new Date("2026-08-29T10:00:00+10:00");
const monthsAgo = (m: number) => new Date(NOW.getTime() - m * 30.4375 * 86_400_000).toISOString();

const subject = (over: Partial<SegmentSubject> = {}): SegmentSubject => ({
  accountId: "a1", name: "Ben & Alice Turner", suburb: "Surrey Hills",
  jobTypes: [], lastCompletedAt: null, wonCents: 0, lastContactAt: null, everQuoted: true, draft: null,
  temperature: null, unsubscribed: false, hasOpenWork: false, snoozed: false,
  ...over,
});

const seg = (criteria: Segment["criteria"]): Segment =>
  ({ key: "t", name: "t", description: "", criteria });

describe("evaluateSegment", () => {
  it("ANDs every criterion — a list that ORs quietly doubles", () => {
    const s = seg([
      { field: "job_type", op: "is", value: "exterior" },
      { field: "completed", op: "more_than", months: 84 },
    ]);
    const old = subject({ accountId: "old", jobTypes: ["exterior"], lastCompletedAt: monthsAgo(96) });
    const recent = subject({ accountId: "recent", jobTypes: ["exterior"], lastCompletedAt: monthsAgo(12) });
    const inside = subject({ accountId: "inside", jobTypes: ["interior"], lastCompletedAt: monthsAgo(96) });
    expect(evaluateSegment([old, recent, inside], s, NOW).map((x) => x.accountId)).toEqual(["old"]);
  });

  it("counts 'never contacted' as longer ago than any window", () => {
    // Otherwise the customer nobody has ever spoken to is excluded from the
    // list built to speak to people nobody has spoken to.
    const s = seg([{ field: "last_contact", op: "more_than", months: 12 }]);
    expect(evaluateSegment([subject({ lastContactAt: null })], s, NOW)).toHaveLength(1);
    const recent = seg([{ field: "last_contact", op: "less_than", months: 12 }]);
    expect(evaluateSegment([subject({ lastContactAt: null })], recent, NOW)).toHaveLength(0);
  });

  it("does not treat 'never finished a job' as 'finished long ago'", () => {
    const s = seg([{ field: "completed", op: "more_than", months: 84 }]);
    expect(evaluateSegment([subject({ lastCompletedAt: null })], s, NOW)).toHaveLength(0);
  });

  it("keeps unsubscribed, open-work and snoozed customers out when asked", () => {
    const s = seg([{ field: "status", op: "is_not", value: ["unsubscribed", "open_work", "snoozed"] }]);
    const ok = subject({ accountId: "ok" });
    const cases = [
      subject({ accountId: "unsub", unsubscribed: true }),
      subject({ accountId: "busy", hasOpenWork: true }),
      subject({ accountId: "snoozed", snoozed: true }),
    ];
    expect(evaluateSegment([ok, ...cases], s, NOW).map((x) => x.accountId)).toEqual(["ok"]);
  });

  it("dates are relative, so a list built once stays right", () => {
    const s = seg([{ field: "completed", op: "more_than", months: 84 }]);
    const customer = subject({ jobTypes: ["exterior"], lastCompletedAt: monthsAgo(83) });
    expect(evaluateSegment([customer], s, NOW)).toHaveLength(0);
    // Two months later, the same customer qualifies, with nobody editing it.
    const later = new Date(NOW.getTime() + 60 * 86_400_000);
    expect(evaluateSegment([customer], s, later)).toHaveLength(1);
  });
});

describe("the standing segments", () => {
  it("finds interior customers with no exterior job — the cross-sell list", () => {
    const target = subject({ accountId: "cross", jobTypes: ["interior"], wonCents: 678_000, lastCompletedAt: monthsAgo(19) });
    const both = subject({ accountId: "both", jobTypes: ["interior", "exterior"], wonCents: 500_000 });
    const busy = subject({ accountId: "busy", jobTypes: ["interior"], wonCents: 500_000, hasOpenWork: true });
    const seg = STANDING_SEGMENTS.find((s) => s.key === "interior_no_exterior")!;
    expect(evaluateSegment([target, both, busy], seg, NOW).map((s) => s.accountId)).toEqual(["cross"]);
  });

  it("finds exteriors due a repaint, and leaves the recent ones alone", () => {
    const due = subject({ accountId: "due", jobTypes: ["exterior"], wonCents: 1_310_000, lastCompletedAt: monthsAgo(96), lastContactAt: monthsAgo(20) });
    const spokenTo = subject({ accountId: "spoken", jobTypes: ["exterior"], wonCents: 900_000, lastCompletedAt: monthsAgo(96), lastContactAt: monthsAgo(2) });
    const seg = STANDING_SEGMENTS.find((s) => s.key === "exteriors_due_repaint")!;
    expect(evaluateSegment([due, spokenTo], seg, NOW).map((s) => s.accountId)).toEqual(["due"]);
  });
});

describe("Tom's ruling: a past customer accepted a quote", () => {
  it("the broad list is customers, not everyone we ever priced", () => {
    // Tom, 30 Aug: "past customers are only the ones who accepted a quote —
    // we won't target customers who have submitted a quote request or that we
    // have quoted and lost."
    const seg = STANDING_SEGMENTS.find((s) => s.key === "past_customers")!;
    const customer = subject({ accountId: "won", everQuoted: true, wonCents: 640_000 });
    const lost = subject({ accountId: "lost", everQuoted: true, wonCents: 0 });
    const enquiry = subject({ accountId: "enquiry", everQuoted: false, wonCents: 0 });
    const gone = subject({ accountId: "gone", everQuoted: true, wonCents: 900_000, unsubscribed: true });
    expect(evaluateSegment([customer, lost, enquiry, gone], seg, NOW).map((s) => s.accountId))
      .toEqual(["won"]);
  });

  it("no standing list can reach someone who never had work done", () => {
    // The rule, enforced across every list at once rather than one at a time.
    const lost = subject({ accountId: "lost", everQuoted: true, wonCents: 0, jobTypes: ["interior"] });
    for (const seg of STANDING_SEGMENTS) {
      expect(evaluateSegment([lost], seg, NOW)).toEqual([]);
    }
  });
});

describe("previewSegment", () => {
  it("counts, samples and values the list", () => {
    const subjects = [
      subject({ accountId: "a", jobTypes: ["interior"], wonCents: 600_000, lastCompletedAt: monthsAgo(20) }),
      subject({ accountId: "b", jobTypes: ["interior"], wonCents: 800_000, lastCompletedAt: monthsAgo(30) }),
      subject({ accountId: "c", jobTypes: ["interior", "exterior"], wonCents: 1_000_000 }),
    ];
    const p = previewSegment(subjects, STANDING_SEGMENTS[0], NOW);
    expect(p.count).toBe(2);
    expect(p.sample.map((s) => s.accountId)).toEqual(["a", "b"]);
    // Average across everyone who has EVER bought (800k), not across the list.
    expect(p.averageCents).toBe(800_000);
    expect(p.worthCents).toBe(1_600_000);
  });

  it("says nothing rather than zero when nobody has ever bought", () => {
    const p = previewSegment([subject({ jobTypes: ["interior"], wonCents: 0 })], STANDING_SEGMENTS[0], NOW);
    expect(p.averageCents).toBeNull();
    expect(p.worthCents).toBeNull();
  });

  it("caps the sample the way the mockup shows it", () => {
    const many = Array.from({ length: 63 }, (_, i) => subject({ accountId: `a${i}`, jobTypes: ["interior"], wonCents: 600_000 }));
    expect(previewSegment(many, STANDING_SEGMENTS[0], NOW).count).toBe(63);
    expect(previewSegment(many, STANDING_SEGMENTS[0], NOW).sample).toHaveLength(20);
  });
});

describe("toSubject", () => {
  it("counts a quote as contact — the bug the live sample caught", () => {
    // Three customers quoted this month matched a list asking for six months
    // of silence, because only events and won work counted as contact.
    const s = toSubject({
      accountId: "a1", name: "Kim", suburb: "Malvern East", temperature: null, snoozedUntil: null,
      estimates: [{ status: "draft", accepted_at: null, total_cents: 996_600, created_at: monthsAgo(0.3), sent_at: null }],
      workOrders: [], lastEventAt: null,
    }, NOW);
    expect(s.lastContactAt).not.toBeNull();
    // A "gone quiet for six months" rule must not catch someone quoted this
    // week, whatever list it belongs to.
    const quiet = seg([{ field: "last_contact", op: "more_than", months: 6 }]);
    expect(evaluateSegment([s], quiet, NOW)).toHaveLength(0);
  });


  it("reads job types from WON work only — a quote is not a job", () => {
    const s = toSubject({
      accountId: "a1", name: "Ben", suburb: "Surrey Hills", temperature: null, snoozedUntil: null,
      estimates: [
        { status: "accepted", accepted_at: monthsAgo(19), jobType: "interior", total_cents: 600_000 },
        { status: "draft", accepted_at: null, jobType: "exterior", total_cents: 900_000 },
      ],
      workOrders: [{ status: "complete", end_date: monthsAgo(18).slice(0, 10) }],
      lastEventAt: null,
    }, NOW);
    expect(s.jobTypes).toEqual(["interior"]);   // the exterior DRAFT does not count
    expect(s.wonCents).toBe(600_000);
    expect(s.hasOpenWork).toBe(false);
  });

  it("reads 'both' as both surfaces", () => {
    const s = toSubject({
      accountId: "a1", name: "Bianca", suburb: "Ivanhoe", temperature: null, snoozedUntil: null,
      estimates: [{ status: "accepted", accepted_at: monthsAgo(2), jobType: "both", total_cents: 1_975_000 }],
      workOrders: [], lastEventAt: null,
    }, NOW);
    expect(s.jobTypes.sort()).toEqual(["exterior", "interior"]);
  });

  it("counts an accepted estimate with no timestamp — the live data gap", () => {
    const s = toSubject({
      accountId: "a1", name: "Margaret", suburb: "Reservoir", temperature: null, snoozedUntil: null,
      estimates: [{ status: "accepted", accepted_at: null, jobType: "interior", total_cents: 845_000 }],
      workOrders: [], lastEventAt: null,
    }, NOW);
    expect(s.wonCents).toBe(845_000);
    expect(s.jobTypes).toEqual(["interior"]);
  });
});

// ---- Tom, 30 Aug: journey criteria — the funnels are ordinary rules now ----

describe("the journey criteria", () => {
  const dropout = (over: Partial<NonNullable<SegmentSubject["draft"]>> = {}) => subject({
    accountId: "drop", everQuoted: false, wonCents: 0,
    draft: { progressPct: 40, uploaded: false, visits: 1, lastSeenAt: NOW.toISOString(), ...over },
  });

  it("finds the under-80% drop-out who left more than a day ago", () => {
    // Funnel one: "need a hand with your estimate?"
    const s = seg([
      { field: "abandoned_draft", op: "is", value: true },
      { field: "draft_progress", op: "less_than", pct: 80 },
      { field: "draft_age", op: "more_than", hours: 24 },
    ]);
    const stale = dropout({ lastSeenAt: new Date(NOW.getTime() - 30 * 3_600_000).toISOString() });
    const fresh = dropout();   // left just now — too soon to chase
    const finished = subject({ accountId: "done", draft: null });
    expect(evaluateSegment([stale, fresh, finished], s, NOW).map((x) => x.accountId)).toEqual(["drop"]);
  });

  it("finds the 80%+ near-finisher — the other funnel", () => {
    const s = seg([
      { field: "abandoned_draft", op: "is", value: true },
      { field: "draft_progress", op: "more_than", pct: 80 },
    ]);
    const near = dropout({ progressPct: 83 });
    const early = dropout({ progressPct: 20 });
    expect(evaluateSegment([near, early], s, NOW).map((x) => x.accountId)).toEqual(["drop"]);
  });

  it("reads uploads and return visits as their own rules", () => {
    const uploaded = seg([{ field: "draft_uploaded", op: "is", value: true }]);
    const returned = seg([{ field: "draft_visits", op: "more_than", count: 1 }]);
    const engaged = dropout({ uploaded: true, visits: 3 });
    const idle = dropout();
    expect(evaluateSegment([engaged, idle], uploaded, NOW)).toHaveLength(1);
    expect(evaluateSegment([engaged, idle], returned, NOW)).toHaveLength(1);
  });

  it("a draft rule can never match someone with no draft", () => {
    const person = subject({ draft: null });
    for (const c of [
      { field: "draft_progress", op: "less_than", pct: 80 },
      { field: "draft_age", op: "more_than", hours: 1 },
      { field: "draft_uploaded", op: "is", value: true },
      { field: "draft_visits", op: "more_than", count: 1 },
    ] as const) {
      expect(evaluateSegment([person], seg([c]), NOW)).toEqual([]);
    }
  });

  it("'no unfinished estimate' matches the people who finished or never started", () => {
    const s = seg([{ field: "abandoned_draft", op: "is", value: false }]);
    expect(evaluateSegment([subject({ draft: null }), dropout()], s, NOW)).toHaveLength(1);
  });
});

describe("criteriaSchema — criteria now arrive from the database and the builder", () => {
  it("accepts every standing list's rules — the seeds cannot drift from the evaluator", () => {
    for (const s of STANDING_SEGMENTS) {
      expect(criteriaSchema.safeParse(s.criteria).success).toBe(true);
    }
  });

  it("refuses a rule the evaluator would not recognise", () => {
    // A criterion that parses but never matches anything is a list that
    // quietly widens or narrows; failing loudly at the edge is the contract.
    expect(criteriaSchema.safeParse([{ field: "shoe_size", op: "is", value: 9 }]).success).toBe(false);
    expect(criteriaSchema.safeParse([{ field: "draft_progress", op: "between", pct: 80 }]).success).toBe(false);
    expect(criteriaSchema.safeParse([]).success).toBe(false);
  });

  it("round-trips the builder's own blanks", () => {
    const blanks = [
      { field: "is_customer", op: "is", value: true },
      { field: "abandoned_draft", op: "is", value: true },
      { field: "draft_age", op: "more_than", hours: 24 },
      { field: "job_value", op: "between", minCents: 0, maxCents: 3_000_000 },
      { field: "status", op: "is_not", value: ["unsubscribed", "open_work"] },
    ];
    expect(criteriaSchema.safeParse(blanks).success).toBe(true);
  });
});
