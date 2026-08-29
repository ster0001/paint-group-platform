import { describe, expect, it } from "vitest";
import {
  evaluateSegment, previewSegment, STANDING_SEGMENTS, toSubject,
  type Segment, type SegmentSubject,
} from "./segments";

const NOW = new Date("2026-08-29T10:00:00+10:00");
const monthsAgo = (m: number) => new Date(NOW.getTime() - m * 30.4375 * 86_400_000).toISOString();

const subject = (over: Partial<SegmentSubject> = {}): SegmentSubject => ({
  accountId: "a1", name: "Ben & Alice Turner", suburb: "Surrey Hills",
  jobTypes: [], lastCompletedAt: null, wonCents: 0, lastContactAt: null, everQuoted: true,
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
    const both = subject({ accountId: "both", jobTypes: ["interior", "exterior"] });
    const busy = subject({ accountId: "busy", jobTypes: ["interior"], hasOpenWork: true });
    const seg = STANDING_SEGMENTS.find((s) => s.key === "interior_no_exterior")!;
    expect(evaluateSegment([target, both, busy], seg, NOW).map((s) => s.accountId)).toEqual(["cross"]);
  });

  it("finds exteriors due a repaint, and leaves the recent ones alone", () => {
    const due = subject({ accountId: "due", jobTypes: ["exterior"], lastCompletedAt: monthsAgo(96), lastContactAt: monthsAgo(20) });
    const spokenTo = subject({ accountId: "spoken", jobTypes: ["exterior"], lastCompletedAt: monthsAgo(96), lastContactAt: monthsAgo(2) });
    const seg = STANDING_SEGMENTS.find((s) => s.key === "exteriors_due_repaint")!;
    expect(evaluateSegment([due, spokenTo], seg, NOW).map((s) => s.accountId)).toEqual(["due"]);
  });
});

describe("the 'quoted, never booked' list", () => {
  it("leaves out an account that was never quoted at all", () => {
    // A bare account — created, never priced — is not someone who saw a
    // number and said no. Found in the live sample, 29 Aug.
    const seg = STANDING_SEGMENTS.find((s) => s.key === "quoted_never_booked")!;
    const bare = subject({ accountId: "bare", everQuoted: false, lastContactAt: null });
    const real = subject({ accountId: "real", everQuoted: true, lastContactAt: monthsAgo(9) });
    expect(evaluateSegment([bare, real], seg, NOW).map((s) => s.accountId)).toEqual(["real"]);
  });
});

describe("the 'everyone we've quoted' list", () => {
  it("is the broad list — quoted, and not unsubscribed", () => {
    // The one list that is allowed to be broad. It still refuses the person
    // who asked not to be written to, because that refusal is absolute.
    const seg = STANDING_SEGMENTS.find((s) => s.key === "everyone_quoted")!;
    const quoted = subject({ accountId: "q", everQuoted: true });
    const busy = subject({ accountId: "busy", everQuoted: true, hasOpenWork: true });
    const gone = subject({ accountId: "gone", everQuoted: true, unsubscribed: true });
    const never = subject({ accountId: "never", everQuoted: false });
    expect(evaluateSegment([quoted, busy, gone, never], seg, NOW).map((s) => s.accountId))
      .toEqual(["q", "busy"]);
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
    const p = previewSegment([subject({ jobTypes: ["interior"] })], STANDING_SEGMENTS[0], NOW);
    expect(p.averageCents).toBeNull();
    expect(p.worthCents).toBeNull();
  });

  it("caps the sample the way the mockup shows it", () => {
    const many = Array.from({ length: 63 }, (_, i) => subject({ accountId: `a${i}`, jobTypes: ["interior"] }));
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
    const quiet = STANDING_SEGMENTS.find((x) => x.key === "quoted_never_booked")!;
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
