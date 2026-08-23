"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setFinishDate } from "./tickActions";

/**
 * The finish / walkthrough date, on the painter's phone (Tom, 23 Aug): what
 * day the customer walkthrough is planned for — the booked final, otherwise
 * the last booked day on site — with a way to move it if the job is finishing
 * earlier or later. Moving it moves the booking's end on the calendar and
 * re-books the walkthrough to the same day; the office is told.
 *
 * A mid-job quality check with a date shows here too, read-only — that one is
 * the office's.
 */
export default function FinishDate({
  workOrderId, finalDate, endDate, startDate, qaDates, stage,
}: {
  workOrderId: string;
  finalDate: string | null;
  endDate: string | null;
  startDate: string | null;
  qaDates: { kind: string; date: string; result: string | null }[];
  stage: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const planned = finalDate ?? endDate;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(planned ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

  async function save() {
    if (!date) { setMessage("Pick a date first."); return; }
    setBusy(true); setMessage(null);
    const r = await setFinishDate({ workOrderId, date });
    setBusy(false);
    if (r.ok) { setEditing(false); setMessage("Date moved — the office and the calendar have it."); router.refresh(); }
    else setMessage(r.message);
  }

  const canMove = stage === "pre_start" || stage === "in_progress" || stage === "completion_prep" || stage === "qa" || stage === "walkthrough";

  return (
    <div className="card" data-testid="finish-date">
      <div className="tick-head">
        <b>Finish &amp; walkthrough</b>
        <span className="tick-count" data-testid="finish-date-value">
          {planned ? fmt(planned) : "date TBC"}
        </span>
      </div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {finalDate
          ? "The customer walkthrough is booked for this day."
          : planned
            ? "Your last booked day on site — the customer walkthrough is planned for then."
            : "No dates booked yet."}
        {canMove && " Finishing earlier or later? Move the date and the office is told."}
      </p>

      {qaDates.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }} data-testid="qa-dates">
          {qaDates.map((q, i) => (
            <p key={i} className="hint" style={{ padding: 0, margin: 0 }}>
              Paint Group quality check{q.kind === "mid" ? " (mid-job)" : ""}: <b>{fmt(q.date)}</b>
              {q.result ? ` · ${q.result}` : ""}
            </p>
          ))}
        </div>
      )}

      {message && <p className="tick-msg" role="status" data-testid="finish-date-msg">{message}</p>}

      {canMove && (editing ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <input ref={ref} type="date" value={date} min={startDate ?? undefined}
            onChange={(e) => setDate(e.target.value)} data-testid="finish-date-input"
            style={{ fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--graphite)", color: "var(--text)" }} />
          <button type="button" className="btn narrow cy" disabled={busy} onClick={() => void save()} data-testid="finish-date-save">
            {busy ? "Saving…" : "Save date"}
          </button>
          <button type="button" className="btn narrow gh" disabled={busy} onClick={() => { setEditing(false); setDate(planned ?? ""); }}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn gh" style={{ marginTop: 10 }} onClick={() => setEditing(true)}
          data-testid="finish-date-change">
          Change the date
        </button>
      ))}
    </div>
  );
}
