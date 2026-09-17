"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finishDayAction, startDayAction } from "./timesheetActions";
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

/**
 * Employed painters (Session 6): the two taps. Start day / Finish day, hours
 * only — no rate, no pay, nothing in dollars (brief §3.8). The office approves
 * each day; the painter sees the status, never the cost.
 *
 * Home: starts on today's assigned job (the RPC picks it; two jobs → "open
 * the one you're at"). Job page: starts on THAT job.
 */
export default function TimesheetCard({ open, recent, error, workOrderId = null, jobTitle = null }: {
  open: TimesheetEntry | null;
  recent: TimesheetEntry[];
  error: string | null;
  /** Set on a job page — Start day clocks on to this job. */
  workOrderId?: string | null;
  jobTitle?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(30);

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

  const onThisJob = open && (!workOrderId || open.workOrderId === workOrderId);
  const shown = recent.filter((e) => e.status !== "open").slice(0, 5);

  return (
    <div className="card" data-testid="timesheet-card">
      <h3>Your day</h3>
      {error && <div className="err">{error}</div>}
      {open ? (
        onThisJob ? (
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
        ) : (
          <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 6 }} data-testid="timesheet-elsewhere">
            Your day is running on another job — finish it from the home page first.
          </div>
        )
      ) : (
        <>
          <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 6 }}>
            {workOrderId ? "Clock on to this job. " : "Clock on to today's job. "}
            The office approves each day; your hours go to payroll from there.
          </div>
          <button type="button" className="btn cy" disabled={busy} onClick={start} data-testid="timesheet-start">
            {busy ? "Saving…" : "Start day"}
          </button>
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
                    {h !== null ? `${h.toFixed(1)} h` : ""}{e.breakMinutes ? ` · ${e.breakMinutes} min break` : ""}
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
