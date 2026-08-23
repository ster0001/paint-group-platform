"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { contractorSendPack } from "./tickActions";

/**
 * The quality check has passed and the job is still sitting at that stage —
 * either side may send it on (Tom, 23 Aug). Normally the office's last PASS
 * sends the pack itself; this is the painter's way through if it didn't.
 */
export default function SendPack({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    const r = await contractorSendPack({ workOrderId });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    setMessage("Done — the customer has their pack. The walkthrough is next.");
    router.refresh();
  }

  return (
    <div className="card" data-testid="qa-passed">
      <div className="tick-head"><b>Quality check passed</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        Paint Group has passed the quality check. Send the job on to the customer
        for their walkthrough and sign-off.
      </p>
      {message && <p className="tick-msg" role="status" data-testid="send-pack-msg">{message}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void send()}
        data-testid="send-pack" style={{ marginTop: 10 }}>
        {busy ? "Sending…" : "Send to the customer — next step"}
      </button>
    </div>
  );
}
