"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeAfterRectification, contractorFinish } from "./tickActions";

/**
 * Every surface done → the painter moves the job on themselves (Tom, 23 Aug).
 * Where it goes is the server's call: a QA-required job routes to quality
 * check and the painter is told, plainly, that sign-off waits for the check.
 */
export default function FinishUp({ workOrderId, flaggedAreas = [] }: {
  workOrderId: string;
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

  async function finish() {
    setBusy(true);
    setMessage(null);
    if (rectified) {
      const rr = await completeAfterRectification({ workOrderId });
      setBusy(false);
      setMessage(rr.ok
        ? "Done — the job is complete. The customer has their completion report, with the areas they flagged and what was put right."
        : rr.message);
      if (rr.ok) router.refresh();
      return;
    }
    const r = await contractorFinish({ workOrderId });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    setMessage(r.to === "qa"
      ? "Nice work. Paint Group will quality check the job now — the sign-off date gets booked with the customer once it passes."
      : r.to === "closed"
        ? "Nice work — no walkthrough on this job, so it's complete. Paint Group will invoice the customer."
        : "Nice work — the customer has their pack, and the walkthrough is next.");
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
      {message && <p className="tick-msg" role="status" data-testid="finish-msg">{message}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void finish()}
        data-testid="finish-job" style={{ marginTop: 10 }}>
        {busy ? (rectified ? "Finishing…" : "Sending…") : rectified ? "Fixed — send the report" : "All done — next step"}
      </button>
    </div>
  );
}
