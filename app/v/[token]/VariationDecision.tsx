"use client";

import { useState, useTransition } from "react";
import { respondToVariationAction } from "./actions";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Approve or decline, and nothing else. The decision is deliberately two plain
 * buttons rather than a form: this arrives on a phone, mid-job, and the whole
 * point is that it takes one tap.
 */
export default function VariationDecision({
  token, priceCents, status,
}: { token: string; priceCents: number; status: string }) {
  const [state, setState] = useState(status);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  if (state === "customer_approved" || state === "contractor_accepted") {
    return (
      <div className="cv-done approved" data-testid="variation-outcome">
        <b>Approved — thank you.</b>
        <p>We&rsquo;ll get straight on with it. The extra {money(priceCents)} will appear on your final invoice.</p>
      </div>
    );
  }
  if (state === "declined") {
    return (
      <div className="cv-done declined" data-testid="variation-outcome">
        <b>Declined.</b>
        <p>No problem — we&rsquo;ll leave that as it is and carry on with the rest of the job.</p>
      </div>
    );
  }

  function respond(approve: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await respondToVariationAction({ token, approve, note });
      if (result.ok) setState(approve ? "customer_approved" : "declined");
      else setMessage(result.message);
    });
  }

  return (
    <div className="cv-actions">
      {message && <p className="cv-msg" role="status" data-testid="variation-message">{message}</p>}

      {asking ? (
        <>
          <label className="cv-label" htmlFor="why">
            Anything you&rsquo;d like us to know? (optional)
          </label>
          <textarea
            id="why" className="cv-note" rows={3} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Leave it for now, we'll look at it later…"
          />
          <button type="button" className="cv-btn ghost" disabled={pending}
            onClick={() => respond(false)} data-testid="confirm-decline">
            {pending ? "Sending…" : "Confirm — don't do this work"}
          </button>
          <button type="button" className="cv-btn link" onClick={() => setAsking(false)}>
            Back
          </button>
        </>
      ) : (
        <>
          <button type="button" className="cv-btn primary" disabled={pending}
            onClick={() => respond(true)} data-testid="approve-variation">
            {pending ? "Sending…" : `Approve ${money(priceCents)}`}
          </button>
          <button type="button" className="cv-btn ghost" disabled={pending}
            onClick={() => setAsking(true)} data-testid="decline-variation">
            No thanks
          </button>
          <p className="cv-fine">
            Nothing is charged until the work is done, and it appears on your final invoice.
          </p>
        </>
      )}
    </div>
  );
}
