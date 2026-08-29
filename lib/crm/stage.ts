/**
 * Which lane a customer sits in, worked out from the record (session 2.3).
 *
 * The rule from the brief, and the mockup says it on screen: "Cards move on
 * their own when the facts change. Nothing here is dragged." There is no stage
 * column, no drag-to-stage, and no way for the board to disagree with the jobs
 * it describes — because the lane is computed from estimates, work orders,
 * invoices and events every time it is read.
 *
 * Seven lanes, matching crm-board-mockup.html exactly. `lost` is an eighth
 * value the function can return and the mockup has no lane for: a declined
 * customer is not on the board, but the function must be able to say so rather
 * than filing them somewhere untrue. ⚑ C1 (final stage list) is still open —
 * when it is ruled, this is the only file that changes.
 */

export const LANES = [
  { key: "enquiry_unfinished", label: "Enquiry unfinished" },
  { key: "estimate_sent", label: "Estimate sent" },
  { key: "visit_booked", label: "Visit booked" },
  { key: "visit_done_no_reply", label: "Visit done, no reply" },
  { key: "negotiating", label: "Negotiating" },
  { key: "job_on", label: "Job on" },
  { key: "past_customer", label: "Past customers" },
] as const;

export type LaneKey = (typeof LANES)[number]["key"];
export type Stage = LaneKey | "lost";

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

/**
 * The lane, and why.
 *
 * Order matters: the further down the job has travelled, the earlier it is
 * tested, so a customer with an old declined quote and a live job reads as a
 * live job. The one exception is `past_customer`, which is only reached when
 * nothing is open at all.
 */
export function stageFor(facts: AccountFacts, now: Date = new Date()): StageResult {
  const est = facts.estimates;
  const open = est.filter((e) => e.status !== "declined" && !e.declined_at);
  const accepted = est.filter((e) => e.accepted_at || e.status === "accepted");
  const sent = open.filter((e) => e.sent_at || e.status === "sent");

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
        goingCold: r.stage !== "past_customer" && inStage != null && inStage >= THRESHOLDS.goingColdDays,
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
  const bookedAt = lastEventAt(facts, "visit_booked");
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
  if (revisedAt && accepted.length === 0) {
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

/** Every open lane — the board's "34 open" is the count across these. */
export const OPEN_LANES: LaneKey[] = LANES.map((l) => l.key).filter((k) => k !== "past_customer");

/** Does this card want attention today? Snoozed cards do not, which is what a
 *  snooze is for; an EXPIRED snooze puts the card back in the count, which is
 *  the mockup's "Snoozed until yesterday" card sitting there with a
 *  follow-up-overdue chip. */
export function needsYouToday(r: StageResult): boolean {
  if (r.flags.snoozed) return false;
  return r.flags.chaseDue || r.flags.followupOverdue || r.flags.goingCold || r.flags.secondAttemptDue;
}
