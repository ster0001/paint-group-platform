"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeAfterRectification, contractorFinish, enterWorkedHours } from "./tickActions";

/**
 * Every surface done → the painter moves the job on themselves (Tom, 23 Aug).
 * Where it goes is the server's call: a QA-required job routes to quality
 * check and the painter is told, plainly, that sign-off waits for the check.
 */
export type HoursAsk = {
  /** Pre-filled from the booking (schedule days × the standard day); null when the booking has no dates. */
  days: number | null;
  hours: number | null;
};

export default function FinishUp({ workOrderId, flaggedAreas = [], hoursAsk = null }: {
  workOrderId: string;
  /**
   * Dashboard 0c (Tom, 19 Sep): present only for a painter whose office flag
   * is on — the final tick asks for days on site and hours. Skipping is
   * allowed (⚑B1): the job then reads from the schedule and says so.
   */
  hoursAsk?: HoursAsk | null;
  /**
   * Tom (17 Sep): areas the customer flagged at their walkthrough, now put
   * right. The card becomes the completion press — the report goes to the
   * customer with the flagged areas in it, no second walkthrough.
   */
  flaggedAreas?: readonly string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rectified = flaggedAreas.length > 0;
  const [days, setDays] = useState(hoursAsk?.days != null ? String(hoursAsk.days) : "");
  const [hours, setHours] = useState(hoursAsk?.hours != null ? String(hoursAsk.hours) : "");
  const [skipHours, setSkipHours] = useState(false);

  /** Record the painter's hours first (when asked and not skipped); the finish never waits on it. */
  async function recordHours(): Promise<string | null> {
    if (!hoursAsk || skipHours) return null;
    const d = Number(days); const h = Number(hours);
    if (!(d > 0) || !(h >= 0)) return "Your hours weren't saved — days must be more than 0. The job still moved on.";
    const r = await enterWorkedHours({ workOrderId, days: d, hours: h });
    return r.ok ? null : `${r.message} The job still moved on.`;
  }

  async function finish() {
    setBusy(true);
    setMessage(null);
    const hoursNote = await recordHours();
    if (rectified) {
      const rr = await completeAfterRectification({ workOrderId });
      setBusy(false);
      setMessage(rr.ok
        ? `Done — the job is complete. The customer has their completion report, with the areas they flagged and what was put right.${hoursNote ? ` ${hoursNote}` : ""}`
        : rr.message);
      if (rr.ok) router.refresh();
      return;
    }
    const r = await contractorFinish({ workOrderId });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    setMessage((r.to === "qa"
      ? "Nice work. Paint Group will quality check the job now — the sign-off date gets booked with the customer once it passes."
      : r.to === "closed"
        ? "Nice work — no walkthrough on this job, so it's complete. Paint Group will invoice the customer."
        : "Nice work — the customer has their pack, and the walkthrough is next.") + (hoursNote ? ` ${hoursNote}` : ""));
    router.refresh();
  }

  return (
    <div className="card" data-testid="finish-up">
      <div className="tick-head"><b>{rectified ? "Flagged areas put right" : "All surfaces done"}</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {rectified
          ? `The customer flagged ${flaggedAreas.join(", ")} at their walkthrough. With those put right and ticked, this completes the job and sends them the completion report — what they flagged and what was done — with no second walkthrough.`
          : "Work through the finishing-up list above, then send the job on — if a quality check is due it happens before the customer walkthrough is booked."}
      </p>
      {hoursAsk && (
        <div className="hours-ask" data-testid="hours-ask" style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <b>How long were you on site?</b>
          <p className="hint" style={{ padding: 0 }}>Pre-filled from the booking — change it to what actually happened. It goes on your invoice as a note; it never changes what you are paid.</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="hint" style={{ padding: 0 }}>Days on site</span>
              <input type="number" inputMode="decimal" min={0.5} step={0.5} value={days} disabled={skipHours}
                onChange={(e) => setDays(e.target.value)} data-testid="hours-days" style={{ width: 110 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="hint" style={{ padding: 0 }}>Hours in total</span>
              <input type="number" inputMode="decimal" min={0} step={0.5} value={hours} disabled={skipHours}
                onChange={(e) => setHours(e.target.value)} data-testid="hours-total" style={{ width: 110 }} />
            </label>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={skipHours} onChange={(e) => setSkipHours(e.target.checked)} data-testid="hours-skip" />
            <span className="hint" style={{ padding: 0 }}>Skip — use the booked days instead</span>
          </label>
        </div>
      )}
      {message && <p className="tick-msg" role="status" data-testid="finish-msg">{message}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void finish()}
        data-testid="finish-job" style={{ marginTop: 10 }}>
        {busy ? (rectified ? "Finishing…" : "Sending…") : rectified ? "Fixed — send the report" : "All done — next step"}
      </button>
    </div>
  );
}
