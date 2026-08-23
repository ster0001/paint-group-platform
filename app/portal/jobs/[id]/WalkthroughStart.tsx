"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startWalkthroughMode } from "./tickActions";

/**
 * §4b Mode A, the painter's end: the job is at walkthrough, the final is
 * booked, the customer is standing next to you — hand them the phone.
 *
 * The button opens the CUSTOMER's walkthrough view in this session (a scoped,
 * two-hour token minted server-side). They walk, approve or flag each area,
 * and type their own name to sign. Nothing here is the contractor signing on
 * the customer's behalf — the phone changes hands, not the signature.
 */
export default function WalkthroughStart({
  workOrderId, finalDate,
}: {
  workOrderId: string;
  /** The booked final, if any — shown so the painter knows the plan. */
  finalDate: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setMessage(null);
    const r = await startWalkthroughMode({ workOrderId });
    setBusy(false);
    if (r.ok) router.push(r.url);
    else setMessage(r.message);
  }

  return (
    <div className="card" data-testid="walkthrough-start">
      <div className="tick-head"><b>Walkthrough &amp; sign-off</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {finalDate
          ? `Final walkthrough booked for ${new Date(finalDate + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}.`
          : "No date booked — start it whenever the customer is with you."}{" "}
        Walk the job with the customer on your phone: they approve each area and
        sign with their own name, right there.
      </p>
      {message && <p className="tick-msg" role="status" data-testid="walkthrough-start-msg">{message}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void start()}
        data-testid="start-walkthrough" style={{ marginTop: 10 }}>
        {busy ? "Opening…" : "Start the walkthrough"}
      </button>
    </div>
  );
}
