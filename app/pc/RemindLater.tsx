"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { remindLater } from "./actions";

/**
 * Tom, 19 Oct 2026: "add a reminder date, to be able to close off an alert and
 * for it to pop back up at a later date". A small "Remind me…" on every card
 * on PC Command: pick a day, the card goes, and it is back that morning if
 * what raised it still stands (a dated dismissal — nothing is stored about the
 * card itself).
 */
export default function RemindLater({ itemKey }: { itemKey: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [min, setMin] = useState("");

  if (done) return <span className="pill p-em" data-testid={`reminded-${itemKey}`}>Back on {done}</span>;
  if (!open) {
    return (
      <button type="button" className="btn dim" onClick={() => { setMin(new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" })); setOpen(true); }} data-testid={`remind-${itemKey}`}
        title="Close this off and have it back on a day you pick">Remind me…</button>
    );
  }
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }} data-testid={`remind-form-${itemKey}`}>
      <input className="edit" type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)}
        aria-label="Remind me on" data-testid={`remind-date-${itemKey}`} style={{ width: "auto" }} />
      <button type="button" className="btn" disabled={pending || !date} data-testid={`remind-set-${itemKey}`}
        onClick={() => start(async () => {
          setMessage(null);
          const r = await remindLater({ itemKey, date });
          if (r.ok) { setDone(date); router.refresh(); } else setMessage(r.message);
        })}>
        {pending ? "…" : "Set"}
      </button>
      <button type="button" className="btn dim" disabled={pending} onClick={() => { setOpen(false); setMessage(null); }}>Cancel</button>
      {message && <span className="note" style={{ color: "var(--amber)" }}>{message}</span>}
    </span>
  );
}
