"use client";

import { useState, useTransition } from "react";
import { bookWalkthrough, markClientUnavailable, setWalkthroughStatus } from "../../actions";

export type WalkthroughRow = {
  id: string; kind: string; scheduledDate: string; status: string;
};

/**
 * §4b, the staff side: book the walkthroughs, and hold the Mode B gate.
 *
 * The final is required and defaults to the last day on site (the RPC reads
 * the booking; the date field here is an override). Remote sign-off stays
 * locked until "missed" or "can't attend" is pressed — both are deliberate,
 * logged staff acts, which is the whole point of the gate.
 */
export default function WalkthroughCard({
  workOrderId, walkthroughs, clientUnavailable, signedAt,
}: {
  workOrderId: string;
  walkthroughs: WalkthroughRow[];
  clientUnavailable: boolean;
  signedAt: string | null;
}) {
  const [date, setDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const r = await fn();
      setMessage(r.message ?? (r.ok ? "Done." : "That didn't work."));
    });

  const final = walkthroughs.find((w) => w.kind === "final" && w.status === "booked");
  const missed = walkthroughs.some((w) => w.kind === "final" && w.status === "missed");
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="card" data-testid="walkthrough-card">
      <h3>Walkthrough <em>{signedAt ? "signed" : final ? fmt(final.scheduledDate) : "not booked"}</em></h3>

      {walkthroughs.length > 0 && (
        <div style={{ display: "grid", gap: 4, margin: "8px 0" }}>
          {walkthroughs.map((w) => (
            <div key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}
              data-testid={`walkthrough-${w.id}`}>
              <span className={`pill ${w.status === "booked" ? "p-cy" : w.status === "missed" ? "p-clay" : ""}`}>
                {w.kind === "final" ? "Final" : "Pre"}
              </span>
              <span>{fmt(w.scheduledDate)}</span>
              <span style={{ color: "var(--muted)" }}>{w.status}</span>
              {w.status === "booked" && !signedAt && (
                <>
                  <button className="btn dim" disabled={pending} style={{ marginLeft: "auto", padding: "4px 8px" }}
                    onClick={() => run(() => setWalkthroughStatus({ walkthroughId: w.id, status: "missed" }))}
                    data-testid={`walkthrough-missed-${w.id}`}>
                    Missed
                  </button>
                  <button className="btn dim" disabled={pending} style={{ padding: "4px 8px" }}
                    onClick={() => run(() => setWalkthroughStatus({ walkthroughId: w.id, status: "cancelled" }))}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!signedAt && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ fontSize: 13 }} data-testid="walkthrough-date" />
            <button className="btn" disabled={pending} data-testid="book-final"
              onClick={() => run(() => bookWalkthrough({ workOrderId, kind: "final", date: date || null, note: "" }))}>
              {final ? "Rebook final" : "Book final"}
            </button>
            <button className="btn dim" disabled={pending}
              onClick={() => run(() => bookWalkthrough({ workOrderId, kind: "pre", date: date || null, note: "" }))}>
              Book pre
            </button>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Book this with the customer when you book the job in. Leave the date
            empty and the final lands on the last day on site.
          </p>

          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            {clientUnavailable || missed ? (
              <p className="note" data-testid="modeb-open">
                Remote sign-off is <b>open</b> — {missed ? "the walkthrough was missed" : "the customer can't attend"}.
                Their own link can sign now.
              </p>
            ) : (
              <>
                <p className="note">
                  Sign-off happens on the painter&rsquo;s phone at the walkthrough. Only open
                  the remote path if the customer genuinely can&rsquo;t be there.
                </p>
                <button className="btn dim" disabled={pending} data-testid="mark-unavailable"
                  onClick={() => run(() => markClientUnavailable({ workOrderId }))}>
                  Customer can&rsquo;t attend — open remote sign-off
                </button>
              </>
            )}
          </div>
        </>
      )}

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid="walkthrough-msg">{message}</p>}
    </div>
  );
}
