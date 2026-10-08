/**
 * THE evaluator (brief §4 — "one evaluator, written once"). Pure. The only
 * code allowed to decide a job result or a colour; PC Command, the painter's
 * app and the home dashboard read its output (written by painter_status_write,
 * migration 20270228). Nothing in the browser computes any of this.
 *
 * Facts in, results out: a job result per closed job (§4.3), the painter's
 * colour, streak and measures (§4.4), and the bonus reviews that should exist
 * (§4.4, ⚑9) — all derived, deterministic, so running it twice changes nothing.
 */
import { callbackScored } from "@/lib/callbacks/model";

export type Colour = "new" | "green" | "yellow" | "orange" | "red";
export type JobResult = "pending" | "clean" | "not_clean";
export type Band = "yellow" | "orange" | "red";

export type StatusRules = {
  /** ⚑25: only jobs signed off on or after this day are scored. */
  launchDate: string;
  /** C6 / R6: the call-back window after sign-off, days. */
  windowDays: number;
  /** R3: clean jobs in a row for Green. */
  greenRun: number;
  /** R5: resulted jobs before a painter leaves New. */
  newJobs: number;
  /** R4: how many resulted jobs the colour looks at. */
  lookback: number;
  /** ⚑24: below this many checks or moments, band by misses not percent. */
  minSample: number;
  /** R15 / ⚑9: qualifying clean jobs per bonus review. */
  bonusEvery: number;
  /** ⚑3 / R15: a job counts for the bonus from this many estimated hours. */
  smallJobHours: number;
};

export const DEFAULT_STATUS_RULES: StatusRules = {
  launchDate: "2026-10-08", windowDays: 7, greenRun: 4, newJobs: 4, lookback: 10, minSample: 5, bonusEvery: 4, smallJobHours: 16,
};

export function mergeStatusRules(raw: unknown): StatusRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, d: number, min = 1) => Number.isInteger(v) && (v as number) >= min ? (v as number) : d;
  return {
    launchDate: typeof r.launchDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.launchDate) ? r.launchDate : DEFAULT_STATUS_RULES.launchDate,
    windowDays: int(r.windowDays, 7, 0), greenRun: int(r.greenRun, 4), newJobs: int(r.newJobs, 4), lookback: int(r.lookback, 10),
    minSample: int(r.minSample, 5), bonusEvery: int(r.bonusEvery, 4), smallJobHours: int(r.smallJobHours, 16),
  };
}

export type JobFacts = {
  workOrderId: string;
  /** True once the work order reached `closed`. Only closed jobs get a result. */
  closed: boolean;
  /** The sign-off's Melbourne calendar day (a no-walkthrough close counts as its sign-off). */
  signedOn: string | null;
  /** Estimated hours on the job sheet. */
  hours: number;
  qaChecks: { id: string; result: "pass" | "fail" | null; attemptNo: number }[];
  /** The job's reminder moments: a texted, unskipped one is scored; answered or not. */
  moments: { id: string; day: string; sendsCount: number; answered: boolean; skipped: boolean }[];
  callbacks: { id: string; reason: "workmanship" | "not_workmanship"; reportedOn: string; status: string }[];
  /** Melbourne days with an app update (a tick or a photo) on this job. */
  updateDays: string[];
  /** The booking's working days. */
  bookedDays: string[];
  /** Days the PC marked No work — an update there earns no credit (R10). */
  noWorkDays: string[];
};

export type PainterFacts = {
  painterId: string;
  employmentType: "contractor" | "employee";
  jobs: JobFacts[];
};

export type ResultRow = {
  workOrderId: string;
  result: JobResult;
  /** Why it is not clean, in the words a painter can read. Empty when clean or pending. */
  reasons: string[];
  hours: number;
  countsForBonus: boolean;
  signedOn: string;
  /** How many of this job's missed moments a credit covered. */
  creditsApplied: number;
  /** The job's share of the three measures — what the colour is banded from, and what the result event carries. */
  checksDone: number;
  checksPassed: number;
  momentsScored: number;
  /** Answered, credits included. */
  momentsAnswered: number;
  callbacksScored: number;
};

export type Measures = {
  checks: { passedFirstTime: number; done: number; band: Band | null };
  reminders: { answered: number; scored: number; creditsApplied: number; band: Band | null };
  callbacks: { scored: number; band: Band };
};

export type Evaluation = {
  painterId: string;
  results: ResultRow[];
  colour: Colour;
  streak: number;
  bestStreak: number;
  stepsToGreen: number;
  measures: Measures;
  /** Qualifying clean jobs since the last review while Green (⚑9). */
  bonusCounter: number;
  /** Every review the history calls for — the writer raises each once. */
  bonusReviews: { triggerWoId: string; qualifyingWoIds: string[] }[];
  /** The colour after each resulted job, in sign-off order — the record a rebuild compares to. */
  history: { workOrderId: string; colour: Colour }[];
  /** Why the painter is this colour, one line. */
  line: string;
};

const todayMelb = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

export function bandOf(pct: number): Band { return pct >= 80 ? "yellow" : pct >= 50 ? "orange" : "red"; }
/** ⚑24: fewer than minSample measurements → by misses: 0–1 Yellow, 2 Orange, 3+ Red. */
export function bandByMisses(misses: number): Band { return misses <= 1 ? "yellow" : misses === 2 ? "orange" : "red"; }
/** R4: scored call backs — 0–1 Yellow, 2–3 Orange, 4+ Red. */
export function callbackBand(n: number): Band { return n <= 1 ? "yellow" : n <= 3 ? "orange" : "red"; }
const WORST: Record<Band, number> = { yellow: 0, orange: 1, red: 2 };
const worst = (bands: Band[]): Band => bands.reduce((w, b) => (WORST[b] > WORST[w] ? b : w), "yellow" as Band);

type Scored = JobFacts & {
  signedOn: string;
  qaFailedFirst: boolean;
  firstAttempts: { result: "pass" | "fail" }[];
  scoredCallbacks: number;
  scoredMoments: { answered: boolean; day: string }[];
  creditsEarned: number;
  creditsApplied: number;
};

/** Step one: every scorable job with its raw slips — before credits. */
function scoreJobs(jobs: readonly JobFacts[], rules: StatusRules): Scored[] {
  return jobs
    .filter((j): j is JobFacts & { signedOn: string } => j.closed && !!j.signedOn && j.signedOn >= rules.launchDate)
    .sort((a, b) => a.signedOn.localeCompare(b.signedOn) || a.workOrderId.localeCompare(b.workOrderId))
    .map((j) => {
      const momentDays = new Set(j.moments.map((m) => m.day));
      const noWork = new Set(j.noWorkDays);
      const booked = new Set(j.bookedDays);
      // R9 / ⚑6: an update on a booked work day with no reminder moment and no "no work" flag earns one credit.
      const creditsEarned = [...new Set(j.updateDays)].filter((d) => booked.has(d) && !momentDays.has(d) && !noWork.has(d)).length;
      const firstAttempts = j.qaChecks.filter((c) => c.attemptNo === 1 && c.result !== null).map((c) => ({ result: c.result as "pass" | "fail" }));
      return {
        ...j,
        qaFailedFirst: firstAttempts.some((c) => c.result === "fail"),
        firstAttempts,
        scoredCallbacks: j.callbacks.filter((cb) => callbackScored(cb as Parameters<typeof callbackScored>[0], j.signedOn, rules.windowDays)).length,
        scoredMoments: j.moments.filter((m) => !m.skipped && m.sendsCount > 0).map((m) => ({ answered: m.answered, day: m.day })),
        creditsEarned,
        creditsApplied: 0,
      };
    });
}

/**
 * ⚑6: a credit covers the oldest uncovered miss on the same job first, then
 * misses on later jobs in sign-off order. Once applied it stays applied. An
 * unused credit lapses when the job that earned it leaves the newest ten.
 */
function applyCredits(scored: Scored[], rules: StatusRules): void {
  const pool: { origin: number }[] = [];
  scored.forEach((j, i) => {
    // Credits from jobs that have left the lookback lapse.
    for (let k = pool.length - 1; k >= 0; k--) if (pool[k].origin <= i - rules.lookback) pool.splice(k, 1);
    let own = j.creditsEarned;
    let misses = j.scoredMoments.filter((m) => !m.answered).length;
    // Same job first…
    while (misses > 0 && own > 0) { own -= 1; misses -= 1; j.creditsApplied += 1; }
    // …then what earlier jobs left over.
    while (misses > 0 && pool.length > 0) { pool.shift(); misses -= 1; j.creditsApplied += 1; }
    for (let k = 0; k < own; k++) pool.push({ origin: i });
  });
}

function resultOf(j: Scored, today: string, rules: StatusRules): ResultRow {
  const reasons: string[] = [];
  if (j.qaFailedFirst) reasons.push("Quality check failed first time");
  if (j.scoredCallbacks > 0) reasons.push(`${j.scoredCallbacks === 1 ? "A call back" : `${j.scoredCallbacks} call backs`} for workmanship`);
  const missed = j.scoredMoments.filter((m) => !m.answered).length - j.creditsApplied;
  if (missed > 0) reasons.push(`Missed ${missed} of ${j.scoredMoments.length} reminder${j.scoredMoments.length === 1 ? "" : "s"}`);
  const result: JobResult = reasons.length ? "not_clean" : addDays(j.signedOn, rules.windowDays) < today ? "clean" : "pending";
  return {
    workOrderId: j.workOrderId, result, reasons, hours: j.hours, countsForBonus: j.hours >= rules.smallJobHours, signedOn: j.signedOn,
    creditsApplied: j.creditsApplied,
    checksDone: j.firstAttempts.length, checksPassed: j.firstAttempts.filter((c) => c.result === "pass").length,
    momentsScored: j.scoredMoments.length, momentsAnswered: j.scoredMoments.filter((m) => m.answered).length + j.creditsApplied,
    callbacksScored: j.scoredCallbacks,
  };
}

/** The per-job summary the colour is banded from — a result row, or a replayed result event. */
export type JobSummary = Pick<ResultRow, "result" | "checksDone" | "checksPassed" | "momentsScored" | "momentsAnswered" | "callbacksScored" | "creditsApplied">;

/** §4.4 over resulted jobs, newest first. */
export function colourFromSummaries(resulted: readonly JobSummary[], rules: StatusRules): { colour: Colour; measures: Measures } {
  const newest10 = resulted.slice(0, rules.lookback);
  const done = newest10.reduce((n, j) => n + j.checksDone, 0);
  const passed = newest10.reduce((n, j) => n + j.checksPassed, 0);
  const checksBand: Band | null = done === 0 ? null : done < rules.minSample ? bandByMisses(done - passed) : bandOf((passed / done) * 100);
  const scoredMoments = newest10.reduce((n, j) => n + j.momentsScored, 0);
  const answered = newest10.reduce((n, j) => n + j.momentsAnswered, 0);
  const creditsApplied = newest10.reduce((n, j) => n + j.creditsApplied, 0);
  const remindersBand: Band | null = scoredMoments === 0 ? null
    : scoredMoments < rules.minSample ? bandByMisses(scoredMoments - answered) : bandOf((answered / scoredMoments) * 100);
  const callbacks = newest10.reduce((n, j) => n + j.callbacksScored, 0);
  const measures: Measures = {
    checks: { passedFirstTime: passed, done, band: checksBand },
    reminders: { answered, scored: scoredMoments, creditsApplied, band: remindersBand },
    callbacks: { scored: callbacks, band: callbackBand(callbacks) },
  };
  if (resulted.length < rules.newJobs) return { colour: "new", measures };
  if (resulted.slice(0, rules.greenRun).every((j) => j.result === "clean")) return { colour: "green", measures };
  const bands = [checksBand, remindersBand, measures.callbacks.band].filter((b): b is Band => b !== null);
  return { colour: worst(bands), measures };
}

export function evaluatePainter(facts: PainterFacts, rules: StatusRules, now: Date): Evaluation {
  const today = todayMelb(now);
  const scored = scoreJobs(facts.jobs, rules);
  applyCredits(scored, rules);
  const rows = scored.map((j) => ({ ...j, row: resultOf(j, today, rules) }));
  const results = rows.map((j) => j.row);

  // Resulted jobs, in sign-off order (ascending for the history, newest-first for the colour).
  const resultedAsc = rows.filter((j) => j.row.result !== "pending").map((j) => j.row);
  const history: Evaluation["history"] = [];
  const bonusReviews: Evaluation["bonusReviews"] = [];
  let counter = 0;
  let qualifying: string[] = [];
  let prev: Colour = "new";
  resultedAsc.forEach((j, i) => {
    const upTo = resultedAsc.slice(0, i + 1).reverse();
    const { colour } = colourFromSummaries(upTo, rules);
    // ⚑9: a qualifying job that becomes clean while the painter is ALREADY Green.
    if (j.result === "clean" && prev === "green" && j.countsForBonus) {
      counter += 1; qualifying.push(j.workOrderId);
      if (counter >= rules.bonusEvery) { bonusReviews.push({ triggerWoId: j.workOrderId, qualifyingWoIds: qualifying }); counter = 0; qualifying = []; }
    }
    if (colour !== "green") { counter = 0; qualifying = []; }
    history.push({ workOrderId: j.workOrderId, colour });
    prev = colour;
  });

  const newestFirst = [...resultedAsc].reverse();
  const { colour, measures } = colourFromSummaries(newestFirst, rules);
  let streak = 0;
  for (const j of newestFirst) { if (j.result === "clean") streak += 1; else break; }
  let best = 0, run = 0;
  for (const j of resultedAsc) { run = j.result === "clean" ? run + 1 : 0; best = Math.max(best, run); }

  return {
    painterId: facts.painterId, results, colour, streak, bestStreak: best,
    stepsToGreen: Math.min(streak, rules.greenRun), measures, bonusCounter: counter, bonusReviews, history,
    line: lineFor(colour, { streak, resulted: newestFirst.length, measures, rules }),
  };
}

function lineFor(colour: Colour, x: { streak: number; resulted: number; measures: Measures; rules: StatusRules }): string {
  switch (colour) {
    case "new": return `Clean job ${Math.min(x.streak, x.rules.newJobs)} of ${x.rules.newJobs}. Finish ${x.rules.greenRun} clean jobs in a row to reach Green.`;
    case "green": return `Your last ${x.rules.greenRun} jobs were all clean.`;
    default: {
      const bits: string[] = [];
      if (x.measures.callbacks.scored > 0) bits.push(`${x.measures.callbacks.scored === 1 ? "One call back" : `${x.measures.callbacks.scored} call backs`}`);
      if (x.measures.checks.done - x.measures.checks.passedFirstTime > 0) bits.push(`${x.measures.checks.done - x.measures.checks.passedFirstTime} failed check${x.measures.checks.done - x.measures.checks.passedFirstTime === 1 ? "" : "s"}`);
      if (x.measures.reminders.scored - x.measures.reminders.answered > 0) bits.push(`${x.measures.reminders.scored - x.measures.reminders.answered} missed reminder${x.measures.reminders.scored - x.measures.reminders.answered === 1 ? "" : "s"}`);
      return `${bits.join(" and ") || "A job that was not clean"} in your last ${Math.min(x.resulted, x.rules.lookback)} jobs.`;
    }
  }
}

/**
 * The event-log rebuild (brief Step 5 acceptance): from the painter's
 * `job_result_set` events alone — each carrying the job's summary as the
 * evaluator last set it — the same colour the evaluator gives.
 */
export type ResultEvent = JobSummary & { workOrderId: string; signedOn: string };
export function colourFromEvents(events: readonly ResultEvent[], rules: StatusRules): Colour {
  // The latest event per job wins (pending → clean, or a late call back flips it).
  const latest = new Map<string, ResultEvent>();
  for (const e of events) latest.set(e.workOrderId, e);
  const resulted = [...latest.values()].filter((e) => e.result !== "pending")
    .sort((a, b) => b.signedOn.localeCompare(a.signedOn) || b.workOrderId.localeCompare(a.workOrderId));
  return colourFromSummaries(resulted, rules).colour;
}

/** Trend (§4.4): the colour now against the colour on the same date last month, from status-changed events. */
export type StatusChange = { at: string; to: Colour };
export function trendOf(changes: readonly StatusChange[], now: Date): "better" | "worse" | "same" {
  const ORDER: Record<Colour, number> = { red: 0, orange: 1, yellow: 2, new: 2, green: 3 };
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at));
  const current = sorted.at(-1)?.to ?? "new";
  const lastMonth = new Date(now); lastMonth.setMonth(lastMonth.getMonth() - 1);
  const then = sorted.filter((c) => new Date(c.at).getTime() <= lastMonth.getTime()).at(-1)?.to ?? "new";
  return ORDER[current] > ORDER[then] ? "better" : ORDER[current] < ORDER[then] ? "worse" : "same";
}
