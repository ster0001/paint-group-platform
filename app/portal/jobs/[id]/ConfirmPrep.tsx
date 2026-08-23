"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contractorConfirmPrep } from "./tickActions";

/**
 * The prep list is done — the painter confirms it, and the server routes the
 * job: quality check when one is due, otherwise the pack goes to the customer
 * and the sign-off begins. The painter never picks the lane (Tom, 23 Aug).
 */
export default function ConfirmPrep({ workOrderId, qaPending }: {
  workOrderId: string;
  /** Checks already scheduled — set expectations before the button press. */
  qaPending: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setMessage(null);
    const r = await contractorConfirmPrep({ workOrderId });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    setMessage(r.to === "qa"
      ? "Confirmed. Paint Group will quality check the job now — the customer walkthrough gets booked once it passes."
      : "Confirmed — the customer has their pack, and the walkthrough is next.");
    router.refresh();
  }

  return (
    <div className="card" data-testid="confirm-prep">
      <div className="tick-head"><b>Completion prep done</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {qaPending
          ? "Confirm completion prep and Paint Group quality checks the job before the customer walkthrough is booked."
          : "Confirm completion prep and the customer gets their pack — sign-off starts from there."}
      </p>
      {message && <p className="tick-msg" role="status" data-testid="confirm-prep-msg">{message}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void confirm()}
        data-testid="confirm-prep-btn" style={{ marginTop: 10 }}>
        {busy ? "Confirming…" : "Completion prep done — next step"}
      </button>
    </div>
  );
}
