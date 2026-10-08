/**
 * The twenty-four golden cases (brief §4.6), written before the evaluator and
 * kept green by it. Plus the two acceptance tests the brief names for Step 5:
 * running twice changes nothing, and a rebuild from the event log alone gives
 * the same colour.
 */
import { describe, expect, test } from "vitest";
import {
  DEFAULT_STATUS_RULES, colourFromEvents, evaluatePainter, mergeStatusRules, trendOf,
  type JobFacts, type PainterFacts, type ResultEvent,
} from "./evaluate";

const rules = { ...DEFAULT_STATUS_RULES, launchDate: "2026-01-01" };
// "Today" for the cases: 30 Nov 2026 — every job signed off in Oct/early Nov is past its 7 days.
const NOW = new Date("2026-11-30T03:00:00Z");

let seq = 0;
type J = Partial<JobFacts> & { signedOn?: string; hours?: number };
/** A closed, signed-off, otherwise clean job: one check passed first time, two moments answered. */
function job(over: J = {}): JobFacts {
  seq += 1;
  const signedOn = over.signedOn ?? `2026-10-${String(seq).padStart(2, "0")}`;
  const base: JobFacts = {
    workOrderId: over.workOrderId ?? `wo${seq}`, closed: true, signedOn, hours: over.hours ?? 40,
    qaChecks: [{ id: `q${seq}`, result: "pass", attemptNo: 1 }],
    moments: [{ id: `m${seq}a`, day: addDays(signedOn, -2), sendsCount: 1, answered: true, skipped: false }, { id: `m${seq}b`, day: addDays(signedOn, -1), sendsCount: 1, answered: true, skipped: false }],
    callbacks: [], updateDays: [addDays(signedOn, -2), addDays(signedOn, -1)], bookedDays: [addDays(signedOn, -2), addDays(signedOn, -1)], noWorkDays: [],
  };
  return { ...base, ...over, signedOn };
}
function addDays(ymd: string, n: number) { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const painter = (jobs: JobFacts[], employmentType: PainterFacts["employmentType"] = "contractor"): PainterFacts => ({ painterId: "p1", employmentType, jobs });
const run = (jobs: JobFacts[], now = NOW) => evaluatePainter(painter(jobs), rules, now);
const resultOf = (e: ReturnType<typeof run>, wo: string) => e.results.find((r) => r.workOrderId === wo)!;

/** N clean jobs then the given ones, in order. */
const clean = (n: number) => Array.from({ length: n }, () => job());
const cleanOf = (n: number, over: J) => Array.from({ length: n }, () => job(over));
const missed = (): JobFacts["moments"][number] => ({ id: `mm${++seq}`, day: "2026-10-01", sendsCount: 2, answered: false, skipped: false });

describe("§4.6 golden cases", () => {
  test("1 · 3 resulted jobs, one not clean → New", () => {
    seq = 0;
    const e = run([job(), job({ qaChecks: [{ id: "q", result: "fail", attemptNo: 1 }] }), job()]);
    expect(e.colour).toBe("new");
    expect(e.results.map((r) => r.result)).toEqual(["clean", "not_clean", "clean"]);
  });

  test("2 · 4 resulted jobs, all clean → Green", () => {
    seq = 0;
    const e = run(clean(4));
    expect(e.colour).toBe("green");
    expect(e.streak).toBe(4);
    expect(e.stepsToGreen).toBe(4);
  });

  test("3 · Green; a workmanship call back on day 3 on the newest job → leaves Green at once, streak 0, Yellow", () => {
    seq = 0;
    const jobs = clean(4);
    const newest = jobs[3];
    newest.callbacks = [{ id: "cb", reason: "workmanship", reportedOn: addDays(newest.signedOn!, 3), status: "booked" }];
    const e = run(jobs);
    expect(resultOf(e, newest.workOrderId).result).toBe("not_clean");
    expect(e.colour).toBe("yellow");
    expect(e.streak).toBe(0);
  });

  test("4 · after case 3, four more clean jobs → Green, with the call back still inside the newest 10", () => {
    seq = 0;
    const jobs = clean(4);
    jobs[3].callbacks = [{ id: "cb", reason: "workmanship", reportedOn: addDays(jobs[3].signedOn!, 3), status: "booked" }];
    const e = run([...jobs, ...clean(4)]);
    expect(e.colour).toBe("green");
    expect(e.measures.callbacks.scored).toBe(1);
  });

  test("5 · a call back with reason 'not workmanship' → no change to result or colour", () => {
    seq = 0;
    const jobs = clean(4);
    jobs[3].callbacks = [{ id: "cb", reason: "not_workmanship", reportedOn: addDays(jobs[3].signedOn!, 3), status: "booked" }];
    const e = run(jobs);
    expect(resultOf(e, jobs[3].workOrderId).result).toBe("clean");
    expect(e.colour).toBe("green");
  });

  test("6 · a customer call back reported on day 7 is scored; on day 8 it is logged but not scored", () => {
    seq = 0;
    const d7 = clean(4); d7[3].callbacks = [{ id: "a", reason: "workmanship", reportedOn: addDays(d7[3].signedOn!, 7), status: "open" }];
    expect(run(d7).colour).toBe("yellow");
    seq = 0;
    const d8 = clean(4); d8[3].callbacks = [{ id: "b", reason: "workmanship", reportedOn: addDays(d8[3].signedOn!, 8), status: "open" }];
    const e = run(d8);
    expect(e.colour).toBe("green");
    expect(e.measures.callbacks.scored).toBe(0);
  });

  test("7 · a quality check fails and is fixed the same day: a failed check, job not clean, no call back record", () => {
    seq = 0;
    const jobs = clean(4);
    jobs[3].qaChecks = [{ id: "q1", result: "fail", attemptNo: 1 }, { id: "q2", result: "pass", attemptNo: 2 }];
    const e = run(jobs);
    const r = resultOf(e, jobs[3].workOrderId);
    expect(r.result).toBe("not_clean");
    expect(r.reasons).toEqual(["Quality check failed first time"]);
    expect(e.measures.callbacks.scored).toBe(0);
  });

  test("8 · a walk-through flagged, fixed and signed the same day: passed after a fix — the job can still be clean", () => {
    // A pass-after-fix is a signature, not a call back and not a failed check: nothing on the job is a slip.
    seq = 0;
    const e = run(clean(4));
    expect(e.results.every((r) => r.result === "clean")).toBe(true);
  });

  test("9 · one missed moment: with one credit on the same job → clean; with none → not clean", () => {
    seq = 0;
    const withCredit = job({ moments: [missed()], updateDays: ["2026-10-03"], bookedDays: ["2026-10-01", "2026-10-03"] });
    const without = job({ moments: [missed()], updateDays: [], bookedDays: ["2026-10-01"] });
    const e = run([withCredit, without]);
    expect(resultOf(e, withCredit.workOrderId).result).toBe("clean");
    expect(resultOf(e, withCredit.workOrderId).creditsApplied).toBe(1);
    expect(resultOf(e, without.workOrderId).result).toBe("not_clean");
    expect(resultOf(e, without.workOrderId).reasons).toEqual(["Missed 1 of 1 reminder"]);
  });

  test("10 · 'No work today' on a moment's day: the moment is skipped and out of the count, and an update that day earns no credit", () => {
    seq = 0;
    const j = job({
      moments: [{ id: "m", day: "2026-10-01", sendsCount: 2, answered: false, skipped: true }, missed()],
      updateDays: ["2026-10-01"], bookedDays: ["2026-10-01", "2026-10-02"], noWorkDays: ["2026-10-01"],
    });
    const e = run([j]);
    const r = resultOf(e, j.workOrderId);
    expect(r.momentsScored).toBe(1);
    expect(r.creditsApplied).toBe(0);
    expect(r.result).toBe("not_clean");
  });

  test("11 · 6 resulted, newest not clean; checks 3 of 5; no call backs; reminders 100% → Orange", () => {
    seq = 0;
    const jobs = [...clean(5), job({ qaChecks: [{ id: "f", result: "fail", attemptNo: 1 }] })];
    jobs[1].qaChecks = [{ id: "f1", result: "fail", attemptNo: 1 }];
    jobs[2].qaChecks = [];
    const e = run(jobs);
    expect(e.measures.checks).toMatchObject({ done: 5, passedFirstTime: 3, band: "orange" });
    expect(e.colour).toBe("orange");
  });

  test("12 · 6 resulted, newest not clean; reminders 12 of 30; checks 100%; no call backs → Red", () => {
    seq = 0;
    const five = (answered: number) => Array.from({ length: 5 }, (_, k) => ({ id: `x${seq}${k}`, day: "2026-10-01", sendsCount: 1, answered: k < answered, skipped: false }));
    const jobs = [job({ moments: five(2) }), job({ moments: five(2) }), job({ moments: five(2) }), job({ moments: five(2) }), job({ moments: five(2) }), job({ moments: five(2) })];
    for (const j of jobs) { j.updateDays = []; }
    const e = run(jobs);
    expect(e.measures.reminders).toMatchObject({ scored: 30, answered: 12, band: "red" });
    expect(e.colour).toBe("red");
  });

  test("13 · 6 resulted, newest not clean; 2 scored call backs → Orange; 4 → Red", () => {
    const cb = (n: number) => { seq = 0; const jobs = clean(6); for (let k = 0; k < n; k++) jobs[5 - k].callbacks = [{ id: `c${k}`, reason: "workmanship", reportedOn: addDays(jobs[5 - k].signedOn!, 2), status: "done" }]; return run(jobs); };
    expect(cb(2).colour).toBe("orange");
    expect(cb(4).colour).toBe("red");
  });

  test("14 · a clean job of 14 hours counts for the streak and the colour, not for the bonus counter", () => {
    seq = 0;
    const e = run([...clean(4), job({ hours: 14 })]);
    expect(e.colour).toBe("green");
    expect(e.streak).toBe(5);
    expect(resultOf(e, "wo5").countsForBonus).toBe(false);
    expect(e.bonusCounter).toBe(0);
  });

  test("15 · the bonus counter reaches 4; the evaluator runs twice → exactly one review, the same one", () => {
    seq = 0;
    const jobs = [...clean(4), ...clean(4)];
    const a = run(jobs), b = run(jobs);
    expect(a.bonusReviews).toHaveLength(1);
    expect(a.bonusReviews[0]).toEqual({ triggerWoId: "wo8", qualifyingWoIds: ["wo5", "wo6", "wo7", "wo8"] });
    expect(b).toEqual(a);
  });

  test("16 · an employed painter: lead on 4 clean jobs, crew on 6 others → scored on the 4 only", () => {
    // Attribution is the facts loader's job (lead = contractor_id): the evaluator only ever sees jobs they led.
    seq = 0;
    const e = evaluatePainter(painter(clean(4), "employee"), rules, NOW);
    expect(e.results).toHaveLength(4);
    expect(e.colour).toBe("green");
  });

  test("17 · a call back fixed by a different painter counts against the painter who did the job", () => {
    // The call back sits on the job's facts whoever fixed it (fixed_by is not an input here).
    seq = 0;
    const jobs = clean(4);
    jobs[3].callbacks = [{ id: "cb", reason: "workmanship", reportedOn: addDays(jobs[3].signedOn!, 1), status: "done" }];
    expect(resultOf(run(jobs), jobs[3].workOrderId).result).toBe("not_clean");
  });

  test("18 · a job closed 3 days ago with no slip is pending and in no count", () => {
    seq = 0;
    const recent = job({ signedOn: "2026-11-27" });
    const e = run([...clean(4), recent]);
    expect(resultOf(e, recent.workOrderId).result).toBe("pending");
    expect(e.streak).toBe(4);
    expect(e.history.map((h) => h.workOrderId)).not.toContain(recent.workOrderId);
  });

  test("19 · a voided call back: job result and colour recomputed", () => {
    seq = 0;
    const jobs = clean(4);
    jobs[3].callbacks = [{ id: "cb", reason: "workmanship", reportedOn: addDays(jobs[3].signedOn!, 1), status: "void" }];
    const e = run(jobs);
    expect(resultOf(e, jobs[3].workOrderId).result).toBe("clean");
    expect(e.colour).toBe("green");
  });

  test("20 · 6 resulted, newest not clean for one missed reminder; no checks at all; reminders 9 of 10 → checks left out; Yellow", () => {
    seq = 0;
    const jobs = clean(6).map((j) => ({ ...j, qaChecks: [] as JobFacts["qaChecks"] }));
    for (const j of jobs) { j.moments = [j.moments[0]]; j.updateDays = []; } // one scored moment each → 6 so far, no credits anywhere
    jobs[0].moments.push({ id: "x1", day: "2026-10-01", sendsCount: 1, answered: true, skipped: false });
    jobs[1].moments.push({ id: "x2", day: "2026-10-02", sendsCount: 1, answered: true, skipped: false });
    jobs[2].moments.push({ id: "x3", day: "2026-10-03", sendsCount: 1, answered: true, skipped: false });
    jobs[3].moments.push({ id: "x4", day: "2026-10-04", sendsCount: 1, answered: true, skipped: false });
    jobs[5].moments = [{ id: "miss", day: "2026-10-05", sendsCount: 2, answered: false, skipped: false }];
    jobs[5].updateDays = [];
    const e = run(jobs);
    expect(e.measures.checks.band).toBeNull();
    expect(e.measures.reminders).toMatchObject({ scored: 10, answered: 9, band: "yellow" });
    expect(e.colour).toBe("yellow");
  });

  test("21 · a job signed off the day before the launch date is never scored; a painter with only such jobs is New", () => {
    seq = 0;
    const late = { ...rules, launchDate: "2026-10-08" };
    const before = [job({ signedOn: "2026-10-07" }), job({ signedOn: "2026-10-06" }), job({ signedOn: "2026-10-05" }), job({ signedOn: "2026-10-04" })];
    const e = evaluatePainter(painter(before), late, NOW);
    expect(e.results).toHaveLength(0);
    expect(e.colour).toBe("new");
  });

  test("22 · Green; one spot check failed and fixed the same day, the only check in the newest 10 → Yellow, not Red (⚑24)", () => {
    seq = 0;
    const jobs = clean(4).map((j) => ({ ...j, qaChecks: [] as JobFacts["qaChecks"] }));
    jobs[3].qaChecks = [{ id: "s", result: "fail", attemptNo: 1 }, { id: "s2", result: "pass", attemptNo: 2 }];
    const e = run(jobs);
    expect(e.measures.checks).toMatchObject({ done: 1, passedFirstTime: 0, band: "yellow" });
    expect(e.colour).toBe("yellow");
  });

  test("23 · the first four clean jobs earn Green; the next four of 16+ hours raise the review — not the first four", () => {
    seq = 0;
    const first = run(clean(4));
    expect(first.colour).toBe("green");
    expect(first.bonusReviews).toHaveLength(0);
    expect(first.bonusCounter).toBe(0);
    seq = 0;
    const e = run([...clean(4), ...cleanOf(3, { hours: 20 })]);
    expect(e.bonusCounter).toBe(3);
    expect(e.bonusReviews).toHaveLength(0);
    seq = 0;
    const e2 = run([...clean(4), ...cleanOf(4, { hours: 20 })]);
    expect(e2.bonusReviews).toHaveLength(1);
    expect(e2.bonusCounter).toBe(0);
  });

  test("24 · a workmanship call back logged on day 12 with a reported date of day 5 flips the job not clean and the colour; reviews already raised are untouched", () => {
    seq = 0;
    const jobs = [...clean(4), ...clean(4)];
    const before = run(jobs);
    expect(before.bonusReviews).toHaveLength(1);
    jobs[7].callbacks = [{ id: "late", reason: "workmanship", reportedOn: addDays(jobs[7].signedOn!, 5), status: "open" }];
    const after = run(jobs);
    expect(resultOf(after, jobs[7].workOrderId).result).toBe("not_clean");
    expect(after.colour).toBe("yellow");
    // The review the history already called for is still called for: the writer never deletes one.
    expect(after.bonusReviews.map((b) => b.triggerWoId)).not.toContain(jobs[7].workOrderId);
  });
});

describe("the acceptance tests the brief names", () => {
  test("running the evaluator twice changes nothing", () => {
    seq = 0;
    const jobs = [...clean(5), job({ qaChecks: [{ id: "f", result: "fail", attemptNo: 1 }] }), job({ moments: [missed()], updateDays: [] })];
    expect(run(jobs)).toEqual(run(jobs));
  });

  test("a painter's colour can be rebuilt from the job_result_set events alone", () => {
    for (const build of [
      () => [...clean(5), job({ qaChecks: [{ id: "f", result: "fail", attemptNo: 1 }] })],
      () => clean(4),
      () => { const j = clean(6); for (let k = 0; k < 4; k++) j[5 - k].callbacks = [{ id: `c${k}`, reason: "workmanship", reportedOn: addDays(j[5 - k].signedOn!, 2), status: "done" }]; return j; },
      () => clean(2),
    ]) {
      seq = 0;
      const e = run(build());
      const events: ResultEvent[] = e.results.map((r) => ({ workOrderId: r.workOrderId, signedOn: r.signedOn, result: r.result, checksDone: r.checksDone, checksPassed: r.checksPassed, momentsScored: r.momentsScored, momentsAnswered: r.momentsAnswered, callbacksScored: r.callbacksScored, creditsApplied: r.creditsApplied }));
      expect(colourFromEvents(events, rules)).toBe(e.colour);
    }
  });

  test("trend reads the status-changed events against the same date last month", () => {
    const now = new Date("2026-11-30T00:00:00Z");
    expect(trendOf([{ at: "2026-10-01T00:00:00Z", to: "yellow" }, { at: "2026-11-15T00:00:00Z", to: "green" }], now)).toBe("better");
    expect(trendOf([{ at: "2026-10-01T00:00:00Z", to: "green" }, { at: "2026-11-15T00:00:00Z", to: "orange" }], now)).toBe("worse");
    expect(trendOf([{ at: "2026-10-01T00:00:00Z", to: "green" }], now)).toBe("same");
  });

  test("rules merge tolerantly", () => {
    expect(mergeStatusRules({ launchDate: "2026-10-08", windowDays: 10, bogus: 1 })).toMatchObject({ launchDate: "2026-10-08", windowDays: 10, greenRun: 4, lookback: 10 });
  });
});
