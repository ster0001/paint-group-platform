/**
 * Which lane a customer sits in, worked out from the record (session 2.3).
 *
 * The rule from the brief, and the mockup says it on screen: "Cards move on
 * their own when the facts change. Nothing here is dragged." There is no stage
 * column, no drag-to-stage, and no way for the board to disagree with the jobs
 * it describes — because the lane is computed from estimates, work orders,
 * invoices and events every time it is read.
 *
 * The mockup's seven lanes, plus the five wizard lanes (6 Sep), plus — CRM v2
 * P1 (7 Sep, deep dive §4.5) — `lapsed` and `lost`. Before P1 a declined
 * customer had no lane and was reachable only through "All", and nothing ever
 * expired an estimate, so a March quote sat in "Estimate sent" for ever.
 * ⚑ C1 (final stage list) is ruled; when it changes again, this is the only
 * file that changes.
 *
 * CRM v2 P1 also caches the result of this function per account in
 * `crm_account_facts` (lib/crm/facts.ts) so lists and rules can run in SQL.
 * That is a cache of THIS function's output, never a second implementation.
 */

import { delayEnded, isQuiet } from "./states";

export const LANES = [
  // Tom, 6 Sep 2026 (buckets brief §4/§6, ⚑C1 ruled): the wizard's five
  // buckets are lanes of their own, so who has just enquired and who has
  // dropped out is visible on the board itself. lib/crm/board.ts files a
  // card into one of these from its wizard session; stageFor never returns
  // them. "Online now" is never worded "In progress" — that is a job on site.
  { key: "online_now", label: "Online now" },
  { key: "wizard_ready", label: "Ready to confirm" },
  { key: "wizard_help", label: "Needs help" },
  { key: "wizard_dropped", label: "Dropped out" },
  { key: "wizard_priced", label: "Priced, no request" },
  // An enquiry that never went through the wizard (an estimate the office started).
  { key: "enquiry_unfinished", label: "Enquiry unfinished" },
  { key: "estimate_sent", label: "Estimate sent" },
  /** P1: every open estimate passed its valid_until. A person decides whether
   *  to chase or close (decision 8.11) — the Today item asks. */
  { key: "lapsed", label: "Quote lapsed" },
  { key: "visit_booked", label: "Visit booked" },
  { key: "visit_done_no_reply", label: "Visit done, no reply" },
  { key: "negotiating", label: "Negotiating" },
  { key: "job_on", label: "Job on" },
  { key: "past_customer", label: "Past customers" },
  /** P1: every estimate declined and nothing open. Kept for reporting; a new
   *  estimate moves them straight back out. */
  { key: "lost", label: "Lost" },
] as const;

export type LaneKey = (typeof LANES)[number]["key"];
export type Stage = LaneKey;

/**
 * The thresholds that turn a card amber. ⚑ C2 is open — these are defaults
 * chosen to be defensible, not ruled, and they live in one object so the
 * ruling is a one-line change and not a hunt.
 */
export const THRESHOLDS = {
  /** Sent, never opened: chase after this many days. */
  chaseUnopenedDays: 3,
  /** Opened and gone quiet: chase after this many days. */
  chaseOpenedDays: 5,
  /** Any lane: this long without movement and the card is going cold. */
  goingColdDays: 14,
  /** After a visit with no reply, a second attempt is due. */
  secondAttemptDays: 7,
  /** A finished job becomes a past customer this long after completion. */
  pastCustomerDays: 30,
} as const;

export type EstimateFact = {
  id: string;
  status: string;
  total_cents: number | null;
  created_at: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
};

export type WorkOrderFact = {
  status: string;
  start_date: string | null;
  end_date: string | null;
};

export type AccountFacts = {
  /** P4: the staff-set relationship state and, for `delayed`, its date; for `lost`, when it was set. */
  relationshipState?: string | null;
  stateUntil?: string | null;
  stateSetAt?: string | null;
  estimates: EstimateFact[];
  workOrders: WorkOrderFact[];
  /** Only the types the lane rules read: visit_booked, visit_completed,
   *  estimate_revised, estimate_viewed. */
  events: Array<{ type: string; occurred_at: string }>;
  temperature: string | null;
  snoozedUntil: string | null;
  followupDueAt: string | null;
};

export type StageResult = {
  stage: Stage;
  /** Plain English for the card's second line: "Opened 3× · 4d". */
  because: string;
  /** When the customer entered this stage — the card's "days in stage". */
  since: string | null;
  flags: {
    chaseDue: boolean;
    followupOverdue: boolean;
    goingCold: boolean;
    snoozed: boolean;
    secondAttemptDue: boolean;
  };
};

const days = (from: string | null, now: Date): number | null =>
  from == null ? null : Math.floor((now.getTime() - new Date(from).getTime()) / 86_400_000);

const latest = <T>(rows: T[], at: (r: T) => string | null): T | null =>
  rows.filter((r) => at(r)).sort((a, b) => String(at(b)).localeCompare(String(at(a))))[0] ?? null;

const lastEventAt = (facts: AccountFacts, type: string): string | null =>
  facts.events.filter((e) => e.type === type)
    .map((e) => e.occurred_at)
    .sort((a, b) => b.localeCompare(a))[0] ?? null;

/** Declined or lapsed: the estimate is no longer with the customer. */
const isClosed = (e: EstimateFact) => e.status === "declined" || e.declined_at != null || e.status === "expired";

/**
 * The lane, and why.
 *
 * Order matters: the further down the job has travelled, the earlier it is
 * tested, so a customer with an old declined quote and a live job reads as a
 * live job. The one exception is `past_customer`, which is only reached when
 * nothing is open at all.
 */
export function stageFor(facts: AccountFacts, now: Date = new Date(), thresholds: Thresholds = THRESHOLDS): StageResult {
  const r = stageInner(facts, now, thresholds);
  // P4: "lost" is a decision, not a deduction. Marked lost by a person, the
  // customer sits in the Lost lane whatever their estimates say — until a
  // new estimate re-opens them (the database does that on its own).
  if (facts.relationshipState === "lost") {
    return { stage: "lost", because: "Marked lost", since: facts.stateSetAt ?? r.since,
      flags: { ...r.flags, chaseDue: false, followupOverdue: false, goingCold: false, secondAttemptDue: false } };
  }
  // A quiet relationship state silences every chase flag — nobody rings a
  // customer who said "not until March", or one who asked never to be called.
  // A delayed customer whose date has passed is awake again, and flagged.
  if (isQuiet(facts.relationshipState, facts.stateUntil, now)) {
    return { ...r, flags: { ...r.flags, chaseDue: false, followupOverdue: false, goingCold: false, secondAttemptDue: false } };
  }
  return r;
}

export type StageThresholds = { chaseUnopenedDays: number; chaseOpenedDays: number; goingColdDays: number; secondAttemptDays: number; pastCustomerDays: number };
type Thresholds = StageThresholds;

function stageInner(facts: AccountFacts, now: Date, THRESHOLDS: Thresholds): StageResult {
  const est = facts.estimates;
  const open = est.filter((e) => !isClosed(e));
  const accepted = est.filter((e) => e.accepted_at || e.status === "accepted");
  const sent = open.filter((e) => e.sent_at || e.status === "sent");
  const lapsed = est.filter((e) => e.status === "expired");

  const liveWO = facts.workOrders.find((w) => w.status === "issued" || w.status === "in_progress");
  const doneWO = latest(facts.workOrders.filter((w) => w.status === "complete"), (w) => w.end_date);

  const flags = {
    chaseDue: false,
    followupOverdue: facts.followupDueAt != null && new Date(facts.followupDueAt) <= now,
    goingCold: false,
    snoozed: facts.snoozedUntil != null && new Date(facts.snoozedUntil) > now,
    secondAttemptDue: false,
  };

  const withCold = (r: Omit<StageResult, "flags">): StageResult => {
    const inStage = days(r.since, now);
    return {
      ...r,
      flags: {
        ...flags,
        goingCold: r.stage !== "past_customer" && r.stage !== "lost" && r.stage !== "lapsed"
          && inStage != null && inStage >= THRESHOLDS.goingColdDays,
        chaseDue: flags.chaseDue,
      },
    };
  };

  // ---- a job in flight beats everything ------------------------------------
  if (liveWO) {
    const started = days(liveWO.start_date, now);
    const total = liveWO.start_date && liveWO.end_date
      ? days(liveWO.start_date, new Date(liveWO.end_date))
      : null;
    return withCold({
      stage: "job_on",
      because: started != null && started >= 0
        ? total ? `Day ${started + 1} of ${total + 1}` : `Started ${started}d ago`
        : liveWO.status === "issued" ? "Booked in, not started" : "Job on",
      since: liveWO.start_date,
    });
  }

  // ---- a visit that has happened, or is about to ---------------------------
  // P6: a booking that was cancelled or missed is no longer a booking — the
  // lane falls through to whatever else is true (the quote, the enquiry).
  const rawBookedAt = lastEventAt(facts, "visit_booked");
  const clearedAt = [lastEventAt(facts, "visit_cancelled"), lastEventAt(facts, "visit_no_show")]
    .filter((x): x is string => !!x).sort().reverse()[0] ?? null;
  const bookedAt = rawBookedAt && (!clearedAt || clearedAt < rawBookedAt) ? rawBookedAt : null;
  const visitedAt = lastEventAt(facts, "visit_completed");
  if (bookedAt && (!visitedAt || visitedAt < bookedAt)) {
    return withCold({ stage: "visit_booked", because: "Visit booked", since: bookedAt });
  }
  if (visitedAt && accepted.length === 0) {
    const silent = days(visitedAt, now) ?? 0;
    const r = withCold({
      stage: "visit_done_no_reply",
      because: silent <= 0 ? "Visited today" : `${silent} day${silent === 1 ? "" : "s"} silent`,
      since: visitedAt,
    });
    r.flags.secondAttemptDue = silent >= THRESHOLDS.secondAttemptDays;
    return r;
  }

  // ---- a quote being argued over -------------------------------------------
  const revisedAt = lastEventAt(facts, "estimate_revised");
  if (revisedAt && accepted.length === 0 && sent.length > 0) {
    const revisions = facts.events.filter((e) => e.type === "estimate_revised").length;
    return withCold({
      stage: "negotiating",
      because: `Revision ${revisions + 1} sent`,
      since: revisedAt,
    });
  }

  // ---- a quote out with the customer ---------------------------------------
  if (accepted.length === 0 && sent.length > 0) {
    const newest = latest(sent, (e) => e.sent_at ?? e.created_at)!;
    const out = days(newest.sent_at ?? newest.created_at, now) ?? 0;
    const views = facts.events.filter((e) => e.type === "estimate_viewed").length;
    const opened = views > 0 || newest.viewed_at != null;
    const r = withCold({
      stage: "estimate_sent",
      because: opened
        ? `Opened${views > 1 ? ` ${views}×` : ""} · ${out}d`
        : `Not opened · ${out}d`,
      since: newest.sent_at ?? newest.created_at,
    });
    r.flags.chaseDue = opened
      ? out >= THRESHOLDS.chaseOpenedDays
      : out >= THRESHOLDS.chaseUnopenedDays;
    return r;
  }

  // ---- finished work, nothing open -----------------------------------------
  if (accepted.length > 0 || doneWO) {
    const finishedAt = doneWO?.end_date ?? latest(accepted, (e) => e.accepted_at)?.accepted_at ?? null;
    const ago = days(finishedAt, now);
    if (ago != null && ago >= THRESHOLDS.pastCustomerDays) {
      const months = Math.round(ago / 30);
      return withCold({
        stage: "past_customer",
        because: months >= 12 ? `${Math.round(months / 12)} year${months >= 18 ? "s" : ""} ago` : `${months} months ago`,
        since: finishedAt,
      });
    }
    // Accepted but no work order yet, or only just finished: still live work.
    return withCold({
      stage: "job_on",
      because: doneWO ? "Just finished" : "Accepted — not booked in",
      since: finishedAt,
    });
  }

  // ---- nothing sent, nothing won -------------------------------------------
  // A quote that lapsed while it was the only thing out: somebody decides.
  // A drafted-but-unsent estimate does not rescue it from this lane — the
  // office has started something new only once it is SENT.
  if (lapsed.length > 0 && sent.length === 0) {
    const newest = latest(lapsed, (e) => e.sent_at ?? e.created_at)!;
    const opened = newest.viewed_at != null || facts.events.some((e) => e.type === "estimate_viewed");
    return withCold({
      stage: "lapsed",
      because: opened ? "Lapsed — was opened" : "Lapsed — never opened",
      since: newest.sent_at ?? newest.created_at,
    });
  }

  const declined = est.filter((e) => e.declined_at || e.status === "declined");
  if (declined.length > 0 && open.length === 0) {
    return withCold({ stage: "lost", because: "Declined", since: latest(declined, (e) => e.declined_at)?.declined_at ?? null });
  }

  const draft = latest(open, (e) => e.created_at);
  const age = days(draft?.created_at ?? null, now);
  return withCold({
    stage: "enquiry_unfinished",
    because: draft
      ? `Estimate started${age != null ? ` · ${age}d` : ""}`
      : "Enquiry with no estimate",
    since: draft?.created_at ?? null,
  });
}

/**
 * Won, and what for.
 *
 * `accepted_at` is not reliably stamped — two of the live accepted estimates
 * carry status 'accepted' with a null timestamp, from a path that never set
 * it. A report that filters on the timestamp alone silently loses those jobs
 * and tells the office a customer brought in nothing. So the STATUS is the
 * authority on whether it was won; the timestamp is only used for dating it.
 */
export function isWon(e: Pick<EstimateFact, "status" | "accepted_at">): boolean {
  return e.status === "accepted" || e.accepted_at != null;
}

/** Every open lane — the board's "34 open" is the count across these. Past
 *  customers and lost customers are not open: nobody is chasing them. */
export const OPEN_LANES: LaneKey[] = LANES.map((l) => l.key).filter((k) => k !== "past_customer" && k !== "lost");

/** Does this card want attention today? Snoozed cards do not, which is what a
 *  snooze is for; an EXPIRED snooze puts the card back in the count, which is
 *  the mockup's "Snoozed until yesterday" card sitting there with a
 *  follow-up-overdue chip. */
export function needsYouToday(r: StageResult, facts?: Pick<AccountFacts, "relationshipState" | "stateUntil">, now: Date = new Date()): boolean {
  if (facts && delayEnded(facts.relationshipState, facts.stateUntil, now)) return true;
  if (r.flags.snoozed) return false;
  return r.flags.chaseDue || r.flags.followupOverdue || r.flags.goingCold || r.flags.secondAttemptDue;
}
