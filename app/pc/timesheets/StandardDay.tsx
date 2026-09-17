"use client";

import { useState, useTransition } from "react";
import { approveStandardDaysAction, autofillNowAction, saveStandardDayAction } from "./actions";

/**
 * S7b (Tom, 17 Sep): the standard day that logs itself, the one-click approve
 * for a normal week, and a "fill now" for a day the evening sweep missed.
 */
export default function StandardDay({ dayStart, dayFinish, breakMinutes, pendingAuto, yesterday }: {
  dayStart: string; dayFinish: string; breakMinutes: number;
  /** Standard days waiting for approval right now. */
  pendingAuto: number;
  yesterday: string;
}) {
  const [start, setStart] = useState(dayStart);
  const [finish, setFinish] = useState(dayFinish);
  const [brk, setBrk] = useState(breakMinutes);
  const [fillDay, setFillDay] = useState(yesterday);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setMessage(null);
    startTransition(async () => { const r = await fn(); setMessage(r.message ?? (r.ok ? "Done." : "Couldn't do that.")); });
  };

  return (
    <div className="card" data-testid="standard-day">
      <h3>Standard day <em>logs itself on every assigned weekday</em></h3>
      <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
        <input className="num" type="time" value={start} onChange={(e) => setStart(e.target.value)} data-testid="standard-start" />
        <span>to</span>
        <input className="num" type="time" value={finish} onChange={(e) => setFinish(e.target.value)} data-testid="standard-finish" />
        <select className="num" style={{ width: 120 }} value={brk} onChange={(e) => setBrk(Number(e.target.value))} data-testid="standard-break">
          <option value={0}>no break</option>
          <option value={30}>30 min</option>
          <option value={45}>45 min</option>
          <option value={60}>60 min</option>
        </select>
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => saveStandardDayAction({ dayStart: start, dayFinish: finish, breakMinutes: brk }))} data-testid="standard-save">
          Save
        </button>
      </div>
      <p className="note" style={{ marginTop: 8 }}>
        Filled every evening for each employee on ONE job that day, unless they clocked or logged it themselves, were sick or on leave, or the job was signed off earlier
        (then it ends at the signature). A painter on two jobs in a day gets nothing filled — record it below. Weekends are never filled.
      </p>
      <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
        <button type="button" className="btn primary" disabled={pending || pendingAuto === 0} onClick={() => run(approveStandardDaysAction)} data-testid="approve-standard-days">
          {pending ? "Working…" : `Approve all standard days (${pendingAuto})`}
        </button>
        <input className="num" type="date" value={fillDay} onChange={(e) => setFillDay(e.target.value)} data-testid="fill-day" />
        <button type="button" className="btn" disabled={pending} onClick={() => run(() => autofillNowAction({ day: fillDay }))} data-testid="fill-now">Fill that day now</button>
      </div>
      {message && <p className="note" data-testid="standard-msg">{message}</p>}
    </div>
  );
}
