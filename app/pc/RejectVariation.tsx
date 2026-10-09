"use client";

import { useState, useTransition } from "react";
import { rejectVariationAction } from "./variationRejectActions";

/**
 * Reject a painter's variation, with a reply that goes back to them (Tom,
 * 8 Oct 2026). Used on PC Command's "Variations for approval" list and on the
 * job page's variation card — one component, both places. The screen says
 * what the reply came to (texted / emailed / not sent and why), never just
 * "done"; the row leaves the list on the next load.
 */
export default function RejectVariation({ variationId, painterName }: { variationId: string; painterName?: string | null }) {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ message: string; delivered: boolean } | null>(null);
  const [pending, start] = useTransition();

  if (outcome) {
    return (
      <p className="note" role="status" data-testid={`reject-outcome-${variationId}`}
        style={{ color: outcome.delivered ? undefined : "var(--amber)", margin: "6px 0 0" }}>
        {outcome.message}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn" data-testid={`reject-variation-${variationId}`}
        onClick={() => { setOpen(true); setError(null); }} style={{ marginTop: 6 }}>
        Reject
      </button>
    );
  }

  function send() {
    setError(null);
    if (reply.trim().length < 3) { setError("Write a short reply for the painter."); return; }
    start(async () => {
      const r = await rejectVariationAction({ variationId, reply });
      if (r.ok) setOutcome({ message: r.message, delivered: r.delivered });
      else setError(r.message);
    });
  }

  return (
    <div data-testid={`reject-box-${variationId}`} style={{ marginTop: 8, display: "grid", gap: 6 }}>
      <label htmlFor={`reject-reply-${variationId}`} style={{ fontSize: 13 }}>
        Reply to {painterName || "the painter"} — sent by text and email
      </label>
      <textarea id={`reject-reply-${variationId}`} className="edit" rows={3} maxLength={1000}
        value={reply} onChange={(e) => setReply(e.target.value)} disabled={pending}
        placeholder="Why it isn't going ahead, or what you'd need instead."
        data-testid={`reject-reply-${variationId}`} />
      {error && <p className="note" role="alert" style={{ color: "var(--amber)", margin: 0 }} data-testid={`reject-error-${variationId}`}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" onClick={send} disabled={pending}
          data-testid={`reject-send-${variationId}`}>
          {pending ? "Sending…" : "Reject and send reply"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
      </div>
    </div>
  );
}
