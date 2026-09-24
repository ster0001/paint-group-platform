"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addQaCheck, setQaRequired, setQaWaived } from "../../actions";

/**
 * Quality-check controls on the staff job page (Tom, 23 Aug):
 *   · "Quality check required" — the job-level flag, for an established
 *     painter's job that should be checked anyway (also a tick when booking);
 *   · "Add a mid-job check" — one standard check is the final; a mid-job one
 *     is added here, with a date the painter sees on their job page;
 *   · "Quality check not required" (Tom, 24 Sep 2026) — the override for ONE
 *     job: a new contractor's cadence would schedule a check, and the office
 *     says not on this one. Removes any due check; a job parked at Quality
 *     check moves on the way a pass would. Flagging a check on again, or
 *     adding a mid-job check, clears it.
 */
export default function QaControls({
  workOrderId, qaRequired, qaWaived = false, scheduledCount, closed,
}: { workOrderId: string; qaRequired: boolean; qaWaived?: boolean; scheduledCount: number; closed: boolean }) {
  const router = useRouter();
  const [required, setRequired] = useState(qaRequired);
  const [waived, setWaived] = useState(qaWaived);
  const [date, setDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (closed) return null;

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 8 }} data-testid="qa-controls">
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
        <input type="checkbox" checked={required} disabled={pending} data-testid="qa-required"
          onChange={(e) => {
            const next = e.target.checked;
            startTransition(async () => {
              setMessage(null);
              const r = await setQaRequired({ workOrderId, required: next });
              if (r.ok) { setRequired(next); if (next) setWaived(false); router.refresh(); } else setMessage(r.message);
            });
          }} />
        Quality check required on this job
        {scheduledCount === 0 && !required && !waived && <span className="pill">none scheduled</span>}
      </label>

      <button type="button" className={`btn ${waived ? "" : "dim"}`} style={{ justifySelf: "start" }}
        disabled={pending} data-testid="qa-not-required"
        onClick={() => startTransition(async () => {
          setMessage(null);
          const next = !waived;
          const r = await setQaWaived({ workOrderId, waived: next });
          if (r.ok) { setWaived(next); if (next) setRequired(false); setMessage(r.message ?? null); router.refresh(); }
          else setMessage(r.message);
        })}>
        {pending ? "Saving…" : waived ? "Quality check not required ✓ — turn back on" : "Quality check not required on this job"}
      </button>
      {waived && (
        <p className="note" style={{ margin: 0 }} data-testid="qa-waived-note">
          No quality check on this job, whatever the painter&rsquo;s record says. The customer signs it off as usual.
        </p>
      )}

      {adding ? (
        <div className="row" style={{ alignItems: "center" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ fontSize: 13 }} data-testid="qa-mid-date" />
          <button className="btn primary" disabled={pending} data-testid="qa-mid-add"
            onClick={() => startTransition(async () => {
              setMessage(null);
              const r = await addQaCheck({ workOrderId, date: date || null });
              if (r.ok) { setAdding(false); setDate(""); setMessage("Mid-job check added."); router.refresh(); }
              else setMessage(r.message);
            })}>
            {pending ? "Adding…" : "Add it"}
          </button>
          <button className="btn dim" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn dim" style={{ justifySelf: "start" }} data-testid="qa-mid-open"
          onClick={() => setAdding(true)}>
          + Add a mid-job check
        </button>
      )}
      <p className="note" style={{ margin: 0 }}>
        One check as standard — the final, before the customer walkthrough. A
        mid-job check is extra; pick the day you&rsquo;ll be on site and the painter
        sees it.
      </p>
      {message && <p className="note" style={{ color: "var(--amber)", margin: 0 }} data-testid="qa-controls-msg">{message}</p>}
    </div>
  );
}
