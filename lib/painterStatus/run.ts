import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/monitoring/report";
import { jobDays } from "@/lib/workorder/jobRhythm";
import { estimatedHours } from "@/lib/workorder/hours";
import type { WorkOrderDoc } from "@/lib/workorder/snapshot";
import { evaluatePainter, mergeStatusRules, type Colour, type JobFacts, type PainterFacts, type StatusRules } from "./evaluate";
import { notifyStatusChanged } from "./notify";
import { staffBonusReview, staffPainterRed } from "@/lib/staff/notify";

/**
 * Facts in, rows out (brief Step 5). SERVER ONLY — the service client or a
 * staff session. Loads what the evaluator needs for a painter, runs the pure
 * evaluator, and hands the result to painter_status_write — the ONE writer.
 * Idempotent by construction: the writer diffs and writes events only for
 * what changed.
 *
 * Who is scored (§4.1): a contractor on the jobs they accepted
 * (work_orders.contractor_id, which the lead assignment mirrors into), an
 * employed painter on the jobs they LED (wo_assignments.is_lead). An employee
 * who never led a job gets no status row.
 */

const MELB_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });

export async function loadStatusRules(db: SupabaseClient): Promise<StatusRules> {
  const { data, error } = await db.from("settings").select("value").eq("key", "painter_status_rules").maybeSingle();
  if (error) reportError(error, { where: "painterStatus.rules", bestEffort: true });
  return mergeStatusRules((data as { value?: unknown } | null)?.value);
}

/** ⚑21: whether painters see their status at all (default on). Service or staff client. */
export async function statusVisibleToPainters(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.from("settings").select("value").eq("key", "painter_status_rules").maybeSingle();
  if (error) { reportError(error, { where: "painterStatus.visible", bestEffort: true }); return false; }
  const v = (data as { value?: { statusVisibleToPainters?: unknown } } | null)?.value?.statusVisibleToPainters;
  return v === undefined ? true : v === true;
}

const COLOURS: readonly Colour[] = ["new", "green", "yellow", "orange", "red"];
const asColour = (s: string): Colour | null => (COLOURS as readonly string[]).includes(s) ? (s as Colour) : null;

type WoRow = {
  id: string; contractor_id: string | null; stage: string; start_date: string | null; end_date: string | null; wo_snapshot: WorkOrderDoc | null;
};

/** Every fact the evaluator needs for one painter. */
export async function loadPainterFacts(db: SupabaseClient, painterId: string): Promise<{ facts: PainterFacts | null; error: string | null }> {
  const c = await db.from("contractors").select("id, employment_type, works_saturday, works_sunday").eq("id", painterId).maybeSingle();
  if (c.error) return { facts: null, error: c.error.message };
  const painter = c.data as { id: string; employment_type: string | null; works_saturday: boolean | null; works_sunday: boolean | null } | null;
  if (!painter) return { facts: null, error: "painter not found" };
  const employee = painter.employment_type === "employee";

  // The jobs that are theirs: an employee's led jobs, a contractor's accepted ones.
  let jobIds: string[];
  if (employee) {
    const led = await db.from("wo_assignments").select("work_order_id").eq("contractor_id", painterId).eq("is_lead", true).neq("status", "released");
    if (led.error) return { facts: null, error: led.error.message };
    jobIds = [...new Set(((led.data ?? []) as { work_order_id: string }[]).map((r) => r.work_order_id))];
  } else {
    const mine = await db.from("work_orders").select("id").eq("contractor_id", painterId).eq("stage", "closed");
    if (mine.error) return { facts: null, error: mine.error.message };
    jobIds = ((mine.data ?? []) as { id: string }[]).map((r) => r.id);
  }
  if (jobIds.length === 0) return { facts: { painterId, employmentType: employee ? "employee" : "contractor", jobs: [] }, error: null };

  const [wos, signoffs, checks, moments, callbacks, flags, updates] = await Promise.all([
    db.from("work_orders").select("id, contractor_id, stage, start_date, end_date, wo_snapshot").in("id", jobIds),
    db.from("wo_signoff").select("work_order_id, signed_at").in("work_order_id", jobIds),
    db.from("wo_qa_checks").select("id, work_order_id, result, attempt_no").in("work_order_id", jobIds),
    db.from("wo_reminder_moments").select("id, work_order_id, day, sends_count, answered_at, skipped_reason").in("work_order_id", jobIds),
    db.from("wo_callbacks").select("id, work_order_id, painter_id, reason, reported_on, status").in("work_order_id", jobIds),
    db.from("wo_day_flags").select("work_order_id, day").in("work_order_id", jobIds).eq("flag", "no_work"),
    db.from("wo_events").select("work_order_id, created_at").in("work_order_id", jobIds).in("type", ["surface_tick", "photo", "all_surfaces_done"]).in("actor_kind", ["contractor", "system"]).limit(5000),
  ]);
  for (const [name, res] of [["work_orders", wos], ["signoff", signoffs], ["checks", checks], ["moments", moments], ["callbacks", callbacks], ["flags", flags], ["updates", updates]] as const) {
    if (res.error) return { facts: null, error: `${name}: ${res.error.message}` };
  }
  const by = <T extends { work_order_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) (m.get(r.work_order_id) ?? m.set(r.work_order_id, []).get(r.work_order_id)!).push(r);
    return m;
  };
  const signedAt = new Map(((signoffs.data ?? []) as { work_order_id: string; signed_at: string | null }[]).map((s) => [s.work_order_id, s.signed_at]));
  const checksBy = by((checks.data ?? []) as { id: string; work_order_id: string; result: "pass" | "fail" | null; attempt_no: number }[]);
  const momentsBy = by((moments.data ?? []) as { id: string; work_order_id: string; day: string; sends_count: number; answered_at: string | null; skipped_reason: string | null }[]);
  const callbacksBy = by((callbacks.data ?? []) as { id: string; work_order_id: string; painter_id: string; reason: "workmanship" | "not_workmanship"; reported_on: string; status: string }[]);
  const flagsBy = by((flags.data ?? []) as { work_order_id: string; day: string }[]);
  const updatesBy = by((updates.data ?? []) as { work_order_id: string; created_at: string }[]);

  const jobs: JobFacts[] = ((wos.data ?? []) as WoRow[]).map((w) => {
    const signed = signedAt.get(w.id) ?? null;
    return {
      workOrderId: w.id,
      closed: w.stage === "closed",
      signedOn: signed ? MELB_DAY.format(new Date(signed)) : null,
      hours: estimatedHours(w.wo_snapshot),
      qaChecks: (checksBy.get(w.id) ?? []).map((q) => ({ id: q.id, result: q.result, attemptNo: q.attempt_no })),
      moments: (momentsBy.get(w.id) ?? []).map((m) => ({ id: m.id, day: m.day, sendsCount: m.sends_count, answered: !!m.answered_at, skipped: !!m.skipped_reason })),
      // C7: every call back on the job counts against the painter who did it, whoever fixed it.
      callbacks: (callbacksBy.get(w.id) ?? []).filter((cb) => cb.painter_id === painterId).map((cb) => ({ id: cb.id, reason: cb.reason, reportedOn: cb.reported_on, status: cb.status })),
      updateDays: [...new Set((updatesBy.get(w.id) ?? []).map((e) => MELB_DAY.format(new Date(e.created_at))))],
      bookedDays: jobDays(w.start_date, w.end_date, { worksSaturday: !!painter.works_saturday, worksSunday: !!painter.works_sunday }),
      noWorkDays: (flagsBy.get(w.id) ?? []).map((f) => f.day),
    };
  });
  return { facts: { painterId, employmentType: employee ? "employee" : "contractor", jobs }, error: null };
}

export type RunOutcome = { painterId: string; ok: boolean; colour?: string; written?: string; error?: string; skipped?: string };

/** Evaluate one painter and write the result through the one writer. */
export async function runPainterStatus(db: SupabaseClient, painterId: string, now = new Date(), rules?: StatusRules): Promise<RunOutcome> {
  try {
    const r = rules ?? (await loadStatusRules(db));
    const { facts, error } = await loadPainterFacts(db, painterId);
    if (!facts) return { painterId, ok: false, error: error ?? "no facts" };
    // An employed painter who never led a job has no status (§4.1).
    if (facts.employmentType === "employee" && facts.jobs.length === 0) return { painterId, ok: true, skipped: "employee with no led jobs" };
    const e = evaluatePainter(facts, r, now);
    const { data, error: wErr } = await db.rpc("painter_status_write", {
      p_painter_id: painterId,
      p_results: e.results.map((x) => ({
        work_order_id: x.workOrderId, result: x.result, reasons: x.reasons, hours: x.hours, counts_for_bonus: x.countsForBonus,
        signed_on: x.signedOn, checks_done: x.checksDone, checks_passed: x.checksPassed, moments_scored: x.momentsScored,
        moments_answered: x.momentsAnswered, callbacks_scored: x.callbacksScored, credits_applied: x.creditsApplied,
      })),
      p_status: { colour: e.colour, streak: e.streak, best_streak: e.bestStreak, measures: { ...e.measures, stepsToGreen: e.stepsToGreen }, bonus_counter: e.bonusCounter, line: e.line },
      p_bonus_reviews: e.bonusReviews.map((b) => ({ trigger_wo_id: b.triggerWoId, qualifying_wo_ids: b.qualifyingWoIds })),
    });
    if (wErr) return { painterId, ok: false, error: wErr.message };
    const s = String(data ?? "");
    if (!s.startsWith("ok:")) return { painterId, ok: false, error: s };
    // Message 6 (Step 6): the writer says 'ok:<changed>:<removed>:<prev>><colour>:<bonus>'.
    // A real change from a real previous colour, and only while painters can see status.
    const prev = asColour(s.split(":")[3]?.split(">")[0] ?? "");
    if (prev && prev !== e.colour && (await statusVisibleToPainters(db))) {
      await notifyStatusChanged(db, painterId, prev, e.colour, facts.employmentType === "employee");
    }
    // Step 7, message 9: the owner hears about a Red the moment it is written (once per drop) …
    if (prev && prev !== "red" && e.colour === "red") {
      const { data: ev, error: evErr } = await db.from("contractor_events").select("id").eq("contractor_id", painterId).eq("type", "status_changed").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (evErr) reportError(evErr, { where: "painterStatus.redAlert", bestEffort: true });
      else if (ev) await staffPainterRed(db, painterId, (ev as { id: string }).id);
    }
    // … and about every bonus review the writer just raised (the card and the message are the same moment).
    if (Number(s.split(":")[4] ?? "0") > 0) {
      const { data: due, error: dErr } = await db.from("painter_bonuses").select("id").eq("painter_id", painterId).eq("status", "due").is("handed_over_at", null);
      if (dErr) reportError(dErr, { where: "painterStatus.bonusAlert", bestEffort: true });
      for (const b of (due ?? []) as { id: string }[]) await staffBonusReview(db, b.id);
    }
    return { painterId, ok: true, colour: e.colour, written: s };
  } catch (err) {
    reportError(err, { where: "painterStatus.run", extra: { painterId } });
    return { painterId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Every painter — the daily pass (finalises pending results once the 7 days
 * pass, seeds every contractor as New at launch) — or only those whose jobs
 * saw an event recently (the half-hour pass).
 */
export async function runPainterStatusSweep(db: SupabaseClient, opts: { since?: Date; now?: Date } = {}): Promise<{ ran: number; failed: number; outcomes: RunOutcome[] }> {
  const now = opts.now ?? new Date();
  const rules = await loadStatusRules(db);
  let ids: string[];
  if (opts.since) {
    const { data, error } = await db.from("wo_events").select("work_order_id").gte("created_at", opts.since.toISOString()).limit(2000);
    if (error) { reportError(error, { where: "painterStatus.sweep.events" }); return { ran: 0, failed: 1, outcomes: [{ painterId: "-", ok: false, error: error.message }] }; }
    const woIds = [...new Set(((data ?? []) as { work_order_id: string }[]).map((e) => e.work_order_id))];
    if (woIds.length === 0) return { ran: 0, failed: 0, outcomes: [] };
    const [wos, leads] = await Promise.all([
      db.from("work_orders").select("contractor_id").in("id", woIds),
      db.from("wo_assignments").select("contractor_id").in("work_order_id", woIds).eq("is_lead", true),
    ]);
    ids = [...new Set([...((wos.data ?? []) as { contractor_id: string | null }[]).map((w) => w.contractor_id), ...((leads.data ?? []) as { contractor_id: string }[]).map((a) => a.contractor_id)].filter((x): x is string => !!x))];
  } else {
    const { data, error } = await db.from("contractors").select("id").eq("active", true);
    if (error) { reportError(error, { where: "painterStatus.sweep.contractors" }); return { ran: 0, failed: 1, outcomes: [{ painterId: "-", ok: false, error: error.message }] }; }
    ids = ((data ?? []) as { id: string }[]).map((c) => c.id);
  }
  const outcomes: RunOutcome[] = [];
  for (const id of ids) outcomes.push(await runPainterStatus(db, id, now, rules));
  return { ran: outcomes.length, failed: outcomes.filter((o) => !o.ok).length, outcomes };
}
