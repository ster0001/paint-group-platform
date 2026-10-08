"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addQaCheck, addSiteVisit, setQaRequired, setQaWaived } from "../../actions";

/**
 * Quality-check controls on the staff job page (Tom, 23 Aug):
 *   · "Quality check required" — the job-level flag, for an established
 *     painter's job that should be checked anyway (also a tick when booking);
 *   · "Add a site check-in" (Tom, 8 Oct 2026: "additional job check-ins in
 *     the PC Command") — an extra visit on a day and time before the final
 *     walkthrough. Since 9 Oct it is NOT a quality check (wo_site_visits,
 *     20270248): "logged just for Felipe", no pass or fail, never a hold on
 *     the job. Only whoever takes quality checks gets the calendar invite;
 *     the painter and the customer are told nothing. PC Command lists it on
 *     the day; its notes and photos live on the Site check-ins card;
 *   · "Quality check not required" (Tom, 24 Sep 2026) — the override for ONE
 *     job: a new contractor's cadence would schedule a check, and the office
 *     says not on this one. Removes any due check; a job parked at Quality
 *     check moves on the way a pass would. Flagging a check on again, or
 *     adding a check-in, clears it.
 */
export default function QaControls({
  workOrderId, qaRequired, qaWaived = false, scheduledCount, closed,
}: { workOrderId: string; qaRequired: boolean; qaWaived?: boolean; scheduledCount: number; closed: boolean }) {
  const router = useRouter();
  const [required, setRequired] = useState(qaRequired);
  const [waived, setWaived] = useState(qaWaived);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
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

      {/* R13 (Step 5): a Green painter is checked only when Paint Group chooses. */}
      <button type="button" className="btn dim" style={{ justifySelf: "start" }} disabled={pending} data-testid="qa-spot-check"
        onClick={() => startTransition(async () => {
          setMessage(null);
          const r = await addQaCheck({ workOrderId, date: null, kind: "spot" });
          if (r.ok) { setMessage(r.message ?? "Spot check added."); router.refresh(); } else setMessage(r.message);
        })}>
        Spot check this job
      </button>

      {adding ? (
        <div className="row" style={{ alignItems: "center" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ fontSize: 13 }} data-testid="qa-mid-date" aria-label="Day" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={900}
            style={{ fontSize: 13 }} data-testid="qa-mid-time" aria-label="Time" />
          <button className="btn primary" disabled={pending || !date || !time} data-testid="qa-mid-add"
            onClick={() => startTransition(async () => {
              setMessage(null);
              const r = await addSiteVisit({ workOrderId, date, time });
              if (r.ok) { setAdding(false); setDate(""); setTime(""); setMessage(r.message ?? "Site check-in added."); router.refresh(); }
              else setMessage(r.message);
            })}>
            {pending ? "Adding…" : "Add it"}
          </button>
          <button className="btn dim" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn dim" style={{ justifySelf: "start" }} data-testid="qa-mid-open"
          onClick={() => setAdding(true)}>
          + Add a site check-in
        </button>
      )}
      <p className="note" style={{ margin: 0 }}>
        The quality check is the main one — at the end of the job, before the
        customer walkthrough. A site check-in is your own visit: pick the day and
        time you&rsquo;ll be on site (before the final) and it goes in the
        quality-check calendar. It has no pass or fail and never holds the job
        up. The painter and the customer aren&rsquo;t told — send the painter a
        note from the visit if you want them to know something.
      </p>
      {message && <p className="note" style={{ color: "var(--amber)", margin: 0 }} data-testid="qa-controls-msg">{message}</p>}
    </div>
  );
}
