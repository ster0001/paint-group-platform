"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scheduleQaCheck } from "../../actions";
import { qaWhenMessage, qaWhenProblem } from "@/lib/workorder/qaSchedule";

export type QaScheduleRow = {
  id: string;
  label: string;
  recheck: boolean;
  result: string | null;
  superseded: boolean;
  thinRecord: boolean;
  date: string | null;
  time: string | null;
  /** What the rule would pick — pre-fills an undated main check. */
  suggested: { date: string; time: string } | null;
  /** The last calendar-invite outcome, in words. */
  invite: string | null;
};

/**
 * The checks on the job facts card, each with its day and time (Tom, 8 Oct
 * 2026: "an option to schedule it in Felipe's calendar, before the final walk
 * through"). An open check can be given a day and time, moved, or taken out of
 * the calendar; the server refuses anything not before the booked final. The
 * invite line says what reached the calendar.
 */
export default function QaSchedule({
  rows, final, today, closed,
}: { rows: QaScheduleRow[]; final: { date: string; time: string | null } | null; today: string; closed: boolean }) {
  return (
    <div data-testid="qa-schedule">
      {rows.map((r) => <Row key={r.id} row={r} final={final} today={today} closed={closed} />)}
      {final && rows.some((r) => r.result === null) && (
        <p className="note" style={{ margin: "4px 0 0" }} data-testid="qa-final-line">
          Final walkthrough {final.date}{final.time ? ` at ${final.time}` : ""} — every check has to be before it. Move the final and the main check moves with it (the working day before).
        </p>
      )}
    </div>
  );
}

function Row({ row, final, today, closed }: { row: QaScheduleRow; final: { date: string; time: string | null } | null; today: string; closed: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(row.date ?? row.suggested?.date ?? "");
  const [time, setTime] = useState(row.time ?? row.suggested?.time ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = row.result === null && !closed;

  const save = (clear: boolean) => startTransition(async () => {
    setMessage(null);
    if (!clear) {
      const problem = qaWhenProblem({ date, time: time || null }, final, today);
      if (!date) { setMessage("Pick a day."); return; }
      if (problem) { setMessage(qaWhenMessage(problem)); return; }
    }
    const r = await scheduleQaCheck({ checkId: row.id, date: clear ? null : date, time: clear ? null : time });
    setMessage(r.message ?? null);
    if (r.ok) { setEditing(false); router.refresh(); }
  });

  return (
    <div className="tick" style={{ flexWrap: "wrap", rowGap: 6 }} data-testid={`qa-row-${row.id}`}>
      <p>
        {row.label}{row.recheck ? " · re-check" : ""}
        {row.date ? <span data-testid={`qa-when-${row.id}`}> · {row.date}{row.time ? ` ${row.time}` : ""}</span> : open ? " · no day set" : ""}
      </p>
      <span className={`pill ${row.result === "pass" ? "p-em" : row.result === "fail" ? "p-clay" : "p-amber"}`}>
        {row.result ?? "due"}{row.result === "fail" && row.superseded ? " · re-checked" : ""}{row.thinRecord ? " · thin record" : ""}
      </span>
      {open && !editing && (
        <button type="button" className="btn dim" style={{ fontSize: 12 }} data-testid={`qa-schedule-open-${row.id}`} onClick={() => setEditing(true)}>
          {row.date ? "Move" : "Set day & time"}
        </button>
      )}
      {row.invite && <p className="note" style={{ margin: 0, flexBasis: "100%" }} data-testid={`qa-invite-${row.id}`}>{row.invite}</p>}
      {editing && (
        <div className="row" style={{ alignItems: "center", flexBasis: "100%", gap: 6 }}>
          <input type="date" value={date} min={today} max={final?.date} onChange={(e) => setDate(e.target.value)}
            style={{ fontSize: 13 }} data-testid={`qa-schedule-date-${row.id}`} aria-label="Day" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={900}
            style={{ fontSize: 13 }} data-testid={`qa-schedule-time-${row.id}`} aria-label="Time" />
          <button type="button" className="btn primary" disabled={pending} data-testid={`qa-schedule-save-${row.id}`} onClick={() => save(false)}>
            {pending ? "Saving…" : "Save"}
          </button>
          {row.date && (
            <button type="button" className="btn dim" disabled={pending} data-testid={`qa-schedule-clear-${row.id}`} onClick={() => save(true)}>
              Take out of the calendar
            </button>
          )}
          <button type="button" className="btn dim" disabled={pending} onClick={() => { setEditing(false); setMessage(null); }}>Cancel</button>
        </div>
      )}
      {message && <p className="note" style={{ margin: 0, flexBasis: "100%", color: "var(--amber)" }} data-testid={`qa-schedule-msg-${row.id}`}>{message}</p>}
    </div>
  );
}
