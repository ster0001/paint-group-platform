"use client";

import { useState, useTransition } from "react";
import { approveTimesheetAction, rejectTimesheetAction } from "./actions";

export type TimesheetRowProp = {
  id: string; painter: string; woRef: string; jobTitle: string; workDate: string;
  start: string; finish: string | null; breakMinutes: number; hours: number | null;
  source: "painter" | "pc"; status: "open" | "submitted" | "approved" | "rejected"; rejectedReason: string;
  /** No cost rate covers this day — approval will refuse; say so before the click. */
  rateMissing: boolean;
};

/** One clocked day: approve it onto the job, or send it back with a reason. */
export default function TimesheetRow(row: TimesheetRowProp) {
  const [state, setState] = useState(row.status);
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function approve() {
    setMessage(null);
    startTransition(async () => {
      const r = await approveTimesheetAction({ entryId: row.id });
      if (r.ok) { setState("approved"); setMessage(r.message ?? null); } else setMessage(r.message);
    });
  }
  function reject() {
    setMessage(null);
    startTransition(async () => {
      const r = await rejectTimesheetAction({ entryId: row.id, reason });
      if (r.ok) { setState("rejected"); setRejecting(false); setMessage(r.message ?? null); } else setMessage(r.message);
    });
  }

  return (
    <div className="card" data-testid={`timesheet-${row.id}`}>
      <h3>
        {row.painter}
        <em>{row.woRef} · {row.workDate}{row.source === "pc" ? " · entered by the office" : ""}</em>
      </h3>
      <div className="draft" data-testid={`timesheet-hours-${row.id}`}>
        {row.jobTitle && <>{row.jobTitle} · </>}
        {row.start}–{row.finish ?? "running"}
        {row.breakMinutes ? ` · ${row.breakMinutes} min break` : ""}
        {row.hours !== null && <> · <b>{row.hours.toFixed(2)} h</b></>}
      </div>
      {row.rateMissing && state === "submitted" && (
        <p className="note" data-testid={`timesheet-norate-${row.id}`}>
          No cost rate covers this day — set one on the Painters screen (dated on or before the day) before approving.
        </p>
      )}
      {message && <p className="note" data-testid={`timesheet-msg-${row.id}`}>{message}</p>}
      <div className="row">
        {state === "approved" ? (
          <span className="btn done" data-testid={`timesheet-approved-${row.id}`}>Approved ✓</span>
        ) : state === "rejected" ? (
          <span className="btn" data-testid={`timesheet-rejected-${row.id}`}>Not approved</span>
        ) : state === "open" ? (
          <span className="btn" style={{ cursor: "default" }}>Still running</span>
        ) : rejecting ? (
          <>
            <input className="num" style={{ width: 260 }} placeholder="Why — the painter sees this" value={reason}
              onChange={(e) => setReason(e.target.value)} data-testid={`timesheet-reason-${row.id}`} />
            <button type="button" className="btn" disabled={pending} onClick={reject} data-testid={`timesheet-reject-confirm-${row.id}`}>Send back</button>
            <button type="button" className="btn" onClick={() => setRejecting(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn primary" disabled={pending} onClick={approve} data-testid={`timesheet-approve-${row.id}`}>
              {pending ? "Saving…" : "Approve"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => setRejecting(true)} data-testid={`timesheet-reject-${row.id}`}>Send back</button>
          </>
        )}
      </div>
    </div>
  );
}
