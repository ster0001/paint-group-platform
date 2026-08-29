/**
 * Segments (session 2.5) — one evaluator, shared by every surface.
 *
 * The brief's rule: the board, the preview, the campaign sweep and the
 * attention queue all call THIS. A campaign that enrols a different set from
 * the one the preview showed is the failure mode that makes an office stop
 * trusting the whole system, and it happens the moment a second copy of these
 * rules exists.
 *
 * Two more rules, both from the brief and both visible in the mockup:
 *   · Criteria are a FORM, not a query language. Every rule below is a field,
 *     an operator and a value — nothing here parses text.
 *   · Dates are always RELATIVE ("completed more than 7 years ago"), so a list
 *     built once stays right without anyone editing it.
 */

import { isWon } from "./stage";

export type Comparison = "is" | "is_not" | "more_than" | "less_than" | "between";

/** The fields a segment can ask about. Adding one is a case here and a row in
 *  the builder — nothing else. */
export type Criterion =
  | { field: "job_type"; op: "is" | "is_not"; value: "interior" | "exterior" | "both" }
  | { field: "has_job_type"; op: "is_not"; value: "interior" | "exterior" }
  | { field: "completed"; op: "more_than" | "less_than"; months: number }
  | { field: "job_value"; op: "between"; minCents: number; maxCents: number }
  | { field: "quoted"; op: "is"; value: boolean }
  /** Tom's ruling, 30 Aug: a "past customer" is someone who ACCEPTED a quote.
   *  Not someone who asked for one, and not someone we quoted and lost. */
  | { field: "is_customer"; op: "is"; value: boolean }
  | { field: "last_contact"; op: "more_than" | "less_than"; months: number }
  | { field: "suburb"; op: "is"; value: string[] }
  | { field: "temperature"; op: "is"; value: Array<"hot" | "warm" | "cold"> }
  | { field: "status"; op: "is_not"; value: Array<"unsubscribed" | "open_work" | "snoozed"> };

export type Segment = {
  key: string;
  name: string;
  /** Shown under the name in the builder, in the office's words. */
  description: string;
  criteria: Criterion[];
  /** A standing segment ships with the product and cannot be deleted. */
  standing?: boolean;
};

/** One customer, flattened to the facts a criterion can ask about. */
export type SegmentSubject = {
  accountId: string;
  name: string;
  suburb: string | null;
  /** Every job type this customer has ever had done, from won work. */
  jobTypes: Array<"interior" | "exterior">;
  /** Completion of the most recent won job. */
  lastCompletedAt: string | null;
  /** Total value of won work — what the campaign is worth talking to. */
  wonCents: number;
  /** Any contact at all: an event, a quote, a job. */
  lastContactAt: string | null;
  /** Has ever been sent or shown a price. */
  everQuoted: boolean;
  temperature: "hot" | "warm" | "cold" | null;
  unsubscribed: boolean;
  hasOpenWork: boolean;
  snoozed: boolean;
};

const monthsBetween = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return (now.getTime() - then.getTime()) / (86_400_000 * 30.4375);
};

/** Does one customer satisfy one criterion? */
export function matchesCriterion(s: SegmentSubject, c: Criterion, now: Date): boolean {
  switch (c.field) {
    case "job_type": {
      const has = c.value === "both"
        ? s.jobTypes.includes("interior") && s.jobTypes.includes("exterior")
        : s.jobTypes.includes(c.value);
      return c.op === "is" ? has : !has;
    }
    case "has_job_type":
      // "…and no exterior job" — the cross-sell rule.
      return !s.jobTypes.includes(c.value);
    case "completed": {
      const m = monthsBetween(s.lastCompletedAt, now);
      if (m == null) return false;   // never finished a job: not "completed X ago"
      return c.op === "more_than" ? m > c.months : m < c.months;
    }
    case "job_value":
      return s.wonCents >= c.minCents && s.wonCents <= c.maxCents;
    case "is_customer":
      return (s.wonCents > 0) === c.value;
    case "quoted":
      // "Never won" is not the same as "was quoted and said no". Without this,
      // an account that only exists — no estimate at all — lands in a list
      // built to chase people who saw a price. Caught by the live sample.
      return s.everQuoted === c.value;
    case "last_contact": {
      const m = monthsBetween(s.lastContactAt, now);
      // Never contacted counts as "more than", because it has been forever.
      if (m == null) return c.op === "more_than";
      return c.op === "more_than" ? m > c.months : m < c.months;
    }
    case "suburb":
      return s.suburb != null && c.value.some((v) => v.toLowerCase() === s.suburb!.toLowerCase());
    case "temperature":
      return s.temperature != null && c.value.includes(s.temperature);
    case "status": {
      // "and not: unsubscribed, or has open work" — the guard every campaign
      // list needs, expressed as a criterion so it is visible in the builder
      // rather than hidden in the sweep.
      const bad = c.value.some((v) =>
        (v === "unsubscribed" && s.unsubscribed) ||
        (v === "open_work" && s.hasOpenWork) ||
        (v === "snoozed" && s.snoozed));
      return !bad;
    }
  }
}

/** Everyone who satisfies every criterion. AND throughout — an OR that nobody
 *  can see in the form is how a list quietly doubles. */
export function evaluateSegment(subjects: SegmentSubject[], segment: Segment, now: Date = new Date()): SegmentSubject[] {
  return subjects.filter((s) => segment.criteria.every((c) => matchesCriterion(s, c, now)));
}

export type SegmentPreview = {
  count: number;
  /** The mockup shows a handful of names under the count, so the office can
   *  sanity-check a list before anything is sent to it. */
  sample: Array<{ accountId: string; name: string; detail: string }>;
  /** "Worth roughly $847k at your average job" — an ESTIMATE, and labelled as
   *  one on screen. Null when there is no won work to average. */
  worthCents: number | null;
  averageCents: number | null;
};

export function previewSegment(
  subjects: SegmentSubject[],
  segment: Segment,
  now: Date = new Date(),
  sampleSize = 20,
): SegmentPreview {
  const matched = evaluateSegment(subjects, segment, now);

  // The average comes from everyone who has ever had work done, not from the
  // segment — a list of people who have never bought would average zero and
  // make the whole list look worthless.
  const priorJobs = subjects.filter((s) => s.wonCents > 0);
  const averageCents = priorJobs.length
    ? Math.round(priorJobs.reduce((n, s) => n + s.wonCents, 0) / priorJobs.length)
    : null;

  return {
    count: matched.length,
    sample: matched.slice(0, sampleSize).map((s) => ({
      accountId: s.accountId,
      name: s.name,
      detail: [s.suburb, s.lastCompletedAt
        ? new Date(s.lastCompletedAt).toLocaleDateString("en-AU", { month: "short", year: "numeric" })
        : null].filter(Boolean).join(" · "),
    })),
    worthCents: averageCents == null ? null : averageCents * matched.length,
    averageCents,
  };
}

/**
 * The standing segments — built in, not deletable.
 *
 * The cross-sell one is the brief's own recommendation (§4): people whose
 * inside you painted and whose outside you have never quoted. They already
 * trust you and have a surface you have never priced.
 */
export const STANDING_SEGMENTS: Segment[] = [
  {
    key: "interior_no_exterior",
    name: "Interior customers with no exterior job",
    description: "You painted their inside. Nobody has ever quoted their outside.",
    standing: true,
    criteria: [
      { field: "is_customer", op: "is", value: true },
      { field: "job_type", op: "is", value: "interior" },
      { field: "has_job_type", op: "is_not", value: "exterior" },
      { field: "status", op: "is_not", value: ["unsubscribed", "open_work"] },
    ],
  },
  {
    key: "exteriors_due_repaint",
    name: "Exteriors due a repaint",
    description: "Exterior work finished more than seven years ago, and quiet for a year.",
    standing: true,
    criteria: [
      { field: "is_customer", op: "is", value: true },
      { field: "job_type", op: "is", value: "exterior" },
      { field: "completed", op: "more_than", months: 84 },
      { field: "last_contact", op: "more_than", months: 12 },
      { field: "status", op: "is_not", value: ["unsubscribed", "open_work"] },
    ],
  },
  {
    key: "past_customers",
    name: "Past customers",
    description: "People who accepted a quote and had the work done. Not people we quoted and lost.",
    standing: true,
    criteria: [
      { field: "is_customer", op: "is", value: true },
      { field: "status", op: "is_not", value: ["unsubscribed"] },
    ],
  },
];

/** The criteria, written out for the builder's read-only rows. */
export function describeCriterion(c: Criterion): { field: string; op: string; value: string } {
  const money = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-AU");
  const years = (m: number) => (m % 12 === 0 ? `${m / 12} years` : `${m} months`);
  switch (c.field) {
    case "job_type": return { field: "Job type", op: c.op === "is" ? "is" : "is not", value: c.value };
    case "has_job_type": return { field: "Has ever had", op: "no", value: `${c.value} job` };
    case "completed": return { field: "Completed", op: c.op === "more_than" ? "more than" : "less than", value: `${years(c.months)} ago` };
    case "job_value": return { field: "Job value", op: "between", value: `${money(c.minCents)} – ${money(c.maxCents)}` };
    case "quoted": return { field: "Was quoted", op: "is", value: c.value ? "yes" : "no" };
    case "is_customer": return { field: "Has had work done", op: "is", value: c.value ? "yes" : "no" };
    case "last_contact": return { field: "Last contact", op: c.op === "more_than" ? "more than" : "less than", value: `${years(c.months)} ago` };
    case "suburb": return { field: "Suburb", op: "is", value: c.value.join(", ") };
    case "temperature": return { field: "Temperature", op: "is", value: c.value.join(", ") };
    case "status": return {
      field: "Status", op: "is not",
      value: c.value.map((v) => v === "open_work" ? "has open work" : v === "snoozed" ? "snoozed" : "unsubscribed").join(", or "),
    };
  }
}

/** Subjects, from the rows a page reads. Kept here so the board, the preview
 *  and the sweep all flatten the same way. */
export function toSubject(input: {
  accountId: string;
  name: string;
  suburb: string | null;
  temperature: string | null;
  snoozedUntil: string | null;
  unsubscribed?: boolean;
  /** `jobType` is the wizard's answer — "interior" | "exterior" | "both".
   *  NOT estimates.job_kind, which is residential/commercial and says nothing
   *  about which surfaces were painted. */
  estimates: Array<{
    status: string; accepted_at: string | null; jobType?: string | null;
    total_cents: number | null; accepted_total_cents?: number | null;
    /** A quote IS contact. Without these, a customer quoted last week looks
     *  like one nobody has ever spoken to, and lands in every "gone quiet"
     *  list — found by reading the sample under a live count, 29 Aug. */
    created_at?: string | null; sent_at?: string | null;
  }>;
  workOrders: Array<{ status: string; end_date: string | null }>;
  lastEventAt: string | null;
}, now: Date = new Date()): SegmentSubject {
  const wonEstimates = input.estimates.filter((e) => isWon({ status: e.status, accepted_at: e.accepted_at }));
  const jobTypes = new Set<"interior" | "exterior">();
  for (const e of wonEstimates) {
    const kind = (e.jobType ?? "").toLowerCase();
    if (kind === "interior" || kind === "both") jobTypes.add("interior");
    if (kind === "exterior" || kind === "both") jobTypes.add("exterior");
  }
  const completed = input.workOrders.filter((w) => w.status === "complete" && w.end_date)
    .map((w) => w.end_date!).sort().reverse();

  const dates = [
    ...wonEstimates.map((e) => e.accepted_at).filter(Boolean) as string[],
    // Every quote counts, sent or merely built: both are the office touching
    // this customer, and "last contact" is asking when that last happened.
    ...input.estimates.flatMap((e) => [e.sent_at, e.created_at]).filter(Boolean) as string[],
    ...completed,
    input.lastEventAt ?? "",
  ].filter(Boolean).sort().reverse();

  return {
    accountId: input.accountId,
    name: input.name,
    suburb: input.suburb,
    jobTypes: [...jobTypes],
    lastCompletedAt: completed[0] ?? wonEstimates.map((e) => e.accepted_at).filter(Boolean).sort().reverse()[0] ?? null,
    wonCents: wonEstimates.reduce((n, e) => n + (e.accepted_total_cents ?? e.total_cents ?? 0), 0),
    lastContactAt: dates[0] ?? null,
    everQuoted: input.estimates.length > 0,
    temperature: (input.temperature as SegmentSubject["temperature"]) ?? null,
    unsubscribed: input.unsubscribed ?? false,
    hasOpenWork: input.workOrders.some((w) => w.status === "issued" || w.status === "in_progress"),
    snoozed: input.snoozedUntil != null && new Date(input.snoozedUntil) > now,
  };
}
