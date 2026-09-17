"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finishDayAction, logExtraHoursAction, startDayAction } from "./timesheetActions";
import { melbourneClock, workedHours, type TimesheetEntry } from "@/lib/timesheets/hours";

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" })
    .format(new Date(iso + "T00:00:00"));

const STATUS: Record<TimesheetEntry["status"], { cls: string; label: string }> = {
  open: { cls: "amb", label: "Running" },
  submitted: { cls: "gry", label: "With the office" },
  approved: { cls: "grn", label: "Approved" },
  rejected: { cls: "cly", label: "Not approved" },
};

export type TimesheetJobOption = { id: string; title: string };

/**
 * Employed painters (Session 6, reshaped 7b on Tom's ruling): a standard day
 * on an assigned job logs ITSELF (07:30–15:30 by default, or to the sign-off
 * when the job closed earlier). The painter only logs the extra — overtime on
 * top of the day. Two jobs on one day are the exception: nothing is logged
 * for them, so Start day / Finish day is there for that. Hours only — no
 * rate, no pay, nothing in dollars (brief §3.8).
 */
export default function TimesheetCard({
  open, recent, error, workOrderId = null, jobTitle = null, jobs = [], today, standardDay = "7:30 am – 3:30 pm",
}: {
  open: TimesheetEntry | null;
  recent: TimesheetEntry[];
  error: string | null;
  /** Set on a job page — extra hours and Start day belong to this job. */
  workOrderId?: string | null;
  jobTitle?: string | null;
  /** The painter's current jobs, for the extra-hours picker on the home page. */
  jobs?: TimesheetJobOption[];
  /** Today's Melbourne date, from the server. */
  today: string;
  standardDay?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(30);
  const [showExtra, setShowExtra] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [extraJob, setExtraJob] = useState(workOrderId ?? jobs[0]?.id ?? "");
  const [extraDate, setExtraDate] = useState(today);
  const [extraStart, setExtraStart] = useState("15:30");
  const [extraFinish, setExtraFinish] = useState("17:00");
  const [extraNote, setExtraNote] = useState("");

  async function start() {
    setBusy(true); setErr(""); setDone("");
    const r = await startDayAction({ workOrderId });
    if (!r.ok) setErr(r.message);
    else setDone(`Day started at ${melbourneClock(new Date().toISOString())}. Tap Finish day when you knock off.`);
    setBusy(false);
    router.refresh();
  }

  async function finish() {
    setBusy(true); setErr(""); setDone("");
    const r = await finishDayAction({ breakMinutes });
    if (!r.ok) setErr(r.message);
    else setDone(`Day finished — ${Number(r.detail).toFixed(1)} hours sent to the office.`);
    setBusy(false);
    router.refresh();
  }

  async function logExtra() {
    setBusy(true); setErr(""); setDone("");
    const r = await logExtraHoursAction({ workOrderId: extraJob, date: extraDate, start: extraStart, finish: extraFinish, note: extraNote });
    if (!r.ok) setErr(r.message);
    else { setDone("Extra hours sent to the office."); setShowExtra(false); setExtraNote(""); }
    setBusy(false);
    router.refresh();
  }

  const onThisJob = open && (!workOrderId || open.workOrderId === workOrderId);
  const shown = recent.filter((e) => e.status !== "open").slice(0, 6);
  const sourceWord = (e: TimesheetEntry) => e.source === "auto" ? "Standard day" : e.source === "pc" ? "Entered by the office" : e.note ? `Extra · ${e.note}` : "Extra hours";

  return (
    <div className="card" data-testid="timesheet-card">
      <h3>Your hours</h3>
      {error && <div className="err">{error}</div>}

      {open && onThisJob ? (
        <>
          <div style={{ fontSize: "13px", marginTop: 6 }} data-testid="timesheet-running">
            Started <b>{melbourneClock(open.startedAt)}</b> · {dayLabel(open.workDate)}
            {jobTitle ? <> · {jobTitle}</> : null}
          </div>
          <label style={{ display: "block", fontSize: "12.5px", color: "var(--muted)", marginTop: 10 }}>
            Break taken
            <select value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))}
              data-testid="timesheet-break" style={{ marginLeft: 8 }}>
              <option value={0}>none</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 hour</option>
            </select>
          </label>
          <button type="button" className="btn cy" disabled={busy} onClick={finish} data-testid="timesheet-finish">
            {busy ? "Saving…" : "Finish day"}
          </button>
        </>
      ) : open ? (
        <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 6 }} data-testid="timesheet-elsewhere">
          Your day is running on another job — finish it from the home page first.
        </div>
      ) : (
        <>
          <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 6 }} data-testid="timesheet-auto-note">
            A standard day ({standardDay}) is logged for you on every day you&rsquo;re on a job — nothing to tap.
            Worked past it? Log the extra. On two jobs in one day? Use Start day / Finish day on each.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn cy" disabled={busy || (!workOrderId && jobs.length === 0)}
              onClick={() => { setShowExtra((v) => !v); setShowClock(false); }} data-testid="timesheet-extra-open">
              Log extra hours
            </button>
            <button type="button" className="btn gh" disabled={busy} onClick={() => { setShowClock((v) => !v); setShowExtra(false); }}
              data-testid="timesheet-clock-open">
              Start day
            </button>
          </div>
          {showClock && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                {workOrderId ? "Clock on to this job now — for a day with more than one job." : "Clock on to today's job now — for a day with more than one job, open the job you're at."}
              </div>
              <button type="button" className="btn cy" disabled={busy} onClick={start} data-testid="timesheet-start">
                {busy ? "Saving…" : "Start day now"}
              </button>
            </div>
          )}
          {showExtra && (
            <div style={{ marginTop: 8 }} data-testid="timesheet-extra">
              {!workOrderId && jobs.length > 1 && (
                <select value={extraJob} onChange={(e) => setExtraJob(e.target.value)} data-testid="timesheet-extra-job" style={{ width: "100%", marginBottom: 6 }}>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: "12.5px" }}>
                <input type="date" value={extraDate} max={today} onChange={(e) => setExtraDate(e.target.value)} data-testid="timesheet-extra-date" />
                <input type="time" value={extraStart} onChange={(e) => setExtraStart(e.target.value)} data-testid="timesheet-extra-start" />
                <span>to</span>
                <input type="time" value={extraFinish} onChange={(e) => setExtraFinish(e.target.value)} data-testid="timesheet-extra-finish" />
              </div>
              <input type="text" placeholder="What for (optional)" value={extraNote} maxLength={300} onChange={(e) => setExtraNote(e.target.value)}
                data-testid="timesheet-extra-note" style={{ width: "100%", marginTop: 6, fontSize: "13px", padding: "8px 10px", boxSizing: "border-box" }} />
              <button type="button" className="btn cy" disabled={busy || !extraJob} onClick={logExtra} data-testid="timesheet-extra-send">
                {busy ? "Saving…" : "Send extra hours"}
              </button>
            </div>
          )}
        </>
      )}
      {done && <div className="ok" data-testid="timesheet-done" style={{ marginTop: 8, fontSize: "12.5px" }}>{done}</div>}
      {err && <div className="err" data-testid="timesheet-error" style={{ marginTop: 8 }}>{err}</div>}

      {shown.length > 0 && (
        <div style={{ marginTop: 12 }} data-testid="timesheet-recent">
          {shown.map((e) => {
            const h = workedHours(e.startedAt, e.finishedAt, e.breakMinutes);
            const s = STATUS[e.status];
            return (
              <div className="act" key={e.id} data-testid={`timesheet-entry-${e.id}`}>
                <i aria-hidden>⏱</i>
                <span>
                  {dayLabel(e.workDate)} · {melbourneClock(e.startedAt)}–{e.finishedAt ? melbourneClock(e.finishedAt) : "…"}
                  <br />
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                    {h !== null ? `${h.toFixed(1)} h` : ""}{e.breakMinutes ? ` · ${e.breakMinutes} min break` : ""} · {sourceWord(e)}
                    {e.status === "rejected" && e.rejectedReason ? ` · ${e.rejectedReason}` : ""}
                  </span>
                </span>
                <span className="push"><span className={`chip ${s.cls}`}>{s.label}</span></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
