"use client";

import { useState } from "react";
import { getCrewLink } from "./tickActions";

/**
 * "Share with your crew" — the contractor hands the job sheet to their
 * painters without handing over their price.
 *
 * The link is minted on first press, so a job nobody shares never has one.
 * "New link" rotates the token: the old link dies on the spot, which is what
 * you want the day a painter leaves the crew.
 */
export default function CrewShare({ workOrderId }: { workOrderId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function fetchLink(rotate: boolean) {
    setBusy(true);
    setMessage(null);
    const r = await getCrewLink({ workOrderId, rotate });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }

    const full = `${window.location.origin}${r.url}`;
    setUrl(full);
    // Clipboard needs a secure context and can still refuse; showing the link
    // beneath the button means a copy failure costs a long-press, not the task.
    try {
      await navigator.clipboard.writeText(full);
      setMessage(rotate ? "New link copied — the old one no longer works." : "Link copied.");
    } catch {
      setMessage(rotate ? "New link ready below — the old one no longer works." : "Link ready below.");
    }
  }

  return (
    <div className="card" data-testid="crew-share">
      <div className="tick-head"><b>Your crew</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        Send your painters the job sheet — the whole scope, colours and photos,
        with your price left off. Anyone with the link can view it, so keep it
        to the crew.
      </p>

      {message && <p className="tick-msg" role="status" data-testid="crew-share-message">{message}</p>}
      {url && (
        <p style={{ fontFamily: "var(--mono)", fontSize: 11, wordBreak: "break-all", color: "var(--muted)", margin: "8px 0 0" }}
          data-testid="crew-share-url">{url}</p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn gh" disabled={busy}
          onClick={() => fetchLink(false)} data-testid="crew-share-copy">
          {busy ? "Working…" : "Share with your crew"}
        </button>
        {url && (
          <button type="button" className="btn gh" disabled={busy}
            onClick={() => {
              // Rotating kills the old link — worth one explicit confirmation.
              if (window.confirm("Get a new link? The old one stops working immediately.")) void fetchLink(true);
            }}
            data-testid="crew-share-rotate">
            New link
          </button>
        )}
      </div>
    </div>
  );
}
