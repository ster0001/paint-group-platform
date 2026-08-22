"use client";

import { useState, useTransition } from "react";
import { reofferJob } from "./actions";

export type ReofferTarget = { id: string; name: string };

/**
 * Reoffer — a real action with a human in it, per Tom's ruling.
 *
 * Confirm before it fires: this withdraws one contractor's offer and gives the
 * job to another. That is not something to do on a mis-tap in a driveway.
 */
export default function ReofferDialog({
  offerId, jobTitle, lapsedName, contractors, defaultStart,
}: {
  offerId: string; jobTitle: string; lapsedName: string;
  contractors: ReofferTarget[]; defaultStart: string;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(contractors[0]?.id ?? "");
  const [start, setStart] = useState(defaultStart);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return <span className="btn done" data-testid={`reoffered-${offerId}`}>Reoffered ✓</span>;
  }

  if (!open) {
    return (
      <button type="button" className="btn primary" onClick={() => setOpen(true)}
        data-testid={`reoffer-${offerId}`}>
        Reoffer
      </button>
    );
  }

  return (
    <div className="reoffer" data-testid={`reoffer-dialog-${offerId}`}>
      <p className="note">
        This withdraws <b>{lapsedName}</b>&rsquo;s offer for <b>{jobTitle}</b> and offers it to
        someone else. {lapsedName.split(" ")[0]} is told their offer has lapsed — no blame.
      </p>

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid={`reoffer-msg-${offerId}`}>{message}</p>}

      <label className="fld">
        To
        <select value={to} onChange={(e) => setTo(e.target.value)} data-testid={`reoffer-to-${offerId}`}>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="fld">
        Start
        <input type="date" className="num" style={{ width: 160 }} value={start}
          onChange={(e) => setStart(e.target.value)} data-testid={`reoffer-start-${offerId}`} />
      </label>
      <input className="num" style={{ width: "100%" }} value={note} placeholder="Note for them (optional)"
        onChange={(e) => setNote(e.target.value)} />

      <div className="row">
        <button type="button" className="btn primary" disabled={pending || !to || !start}
          data-testid={`reoffer-confirm-${offerId}`}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const r = await reofferJob({ offerId, contractorId: to, start, note });
              if (r.ok) setDone(true); else setMessage(r.message);
            });
          }}>
          {pending ? "Reoffering…" : "Withdraw and reoffer"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
