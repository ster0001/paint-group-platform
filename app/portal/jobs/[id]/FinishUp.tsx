"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contractorFinish } from "./tickActions";

/**
 * Every surface done → the painter moves the job on themselves (Tom, 23 Aug).
 * Where it goes is the server's call: a QA-required job routes to quality
 * check and the painter is told, plainly, that sign-off waits for the check.
 */
export default function FinishUp({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setMessage(null);
    const r = await contractorFinish({ workOrderId });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    setMessage(r.qaPending
      ? "Nice work — on to completion prep. Heads up: Paint Group will quality check this job before sign-off, so the sign-off date gets booked once the check has passed."
      : "Nice work — on to completion prep. Confirm it and the sign-off gets moving.");
    router.refresh();
  }

  return (
    <div className="card" data-testid="finish-up">
      <div className="tick-head"><b>All surfaces done</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        Everything&rsquo;s ticked. Next up is completion prep — the last pass
        before handover.
      </p>
      {message && <p className="tick-msg" role="status" data-testid="finish-msg">{message}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void finish()}
        data-testid="finish-job" style={{ marginTop: 10 }}>
        {busy ? "Sending…" : "I'm done — next step"}
      </button>
    </div>
  );
}
