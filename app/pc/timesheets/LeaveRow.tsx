"use client";

import { useState, useTransition } from "react";
import { decideLeaveAction } from "./actions";

export type LeaveRowProp = {
  id: string; painter: string; kind: "leave" | "rdo"; start: string; end: string; reason: string; requestedAt: string;
  /** A booked job the days land on — approval will refuse until it is reassigned. */
  clashes: string[];
};

const dmy = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");

/** One leave / RDO request: approve it onto the board, or decline with a reason the painter sees. */
export default function LeaveRow(row: LeaveRowProp) {
  const [state, setState] = useState<"pending" | "approved" | "declined">("pending");
  const [message, setMessage] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    setMessage(null);
    startTransition(async () => {
      const r = await decideLeaveAction({ id: row.id, approve, note });
      if (r.ok) { setState(approve ? "approved" : "declined"); setDeclining(false); setMessage(r.message ?? null); }
      else setMessage(r.message);
    });
  }

  return (
    <div className="card" data-testid={`leave-${row.id}`}>
      <h3>
        {row.painter}
        <em>{row.kind === "rdo" ? "RDO" : "Leave"} · {row.start === row.end ? dmy(row.start) : `${dmy(row.start)}–${dmy(row.end)}`}</em>
      </h3>
      <div className="draft">
        {row.reason ? <>&ldquo;{row.reason}&rdquo;</> : <>No reason given.</>}
        {row.clashes.length > 0 && (
          <> <b data-testid={`leave-clash-${row.id}`}>Booked on {row.clashes.join(", ")} — reassign those days first, or decline.</b></>
        )}
      </div>
      {message && <p className="note" data-testid={`leave-msg-${row.id}`}>{message}</p>}
      <div className="row">
        {state === "approved" ? (
          <span className="btn done" data-testid={`leave-approved-${row.id}`}>Approved ✓</span>
        ) : state === "declined" ? (
          <span className="btn" data-testid={`leave-declined-${row.id}`}>Declined</span>
        ) : declining ? (
          <>
            <input className="num" style={{ width: 260 }} placeholder="Why — the painter sees this" value={note}
              onChange={(e) => setNote(e.target.value)} data-testid={`leave-note-${row.id}`} />
            <button type="button" className="btn" disabled={pending} onClick={() => decide(false)} data-testid={`leave-decline-confirm-${row.id}`}>Decline</button>
            <button type="button" className="btn" onClick={() => setDeclining(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn primary" disabled={pending} onClick={() => decide(true)} data-testid={`leave-approve-${row.id}`}>
              {pending ? "Saving…" : "Approve"}
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => setDeclining(true)} data-testid={`leave-decline-${row.id}`}>Decline</button>
          </>
        )}
      </div>
    </div>
  );
}
