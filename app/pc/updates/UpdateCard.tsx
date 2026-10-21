"use client";

import { useState, useTransition } from "react";
import { approveAndSendUpdate, approveUpdate, dismissUpdate } from "../actions";

/** "Tue 14 Oct, 3:42 pm" in Melbourne time — never the UTC date (CLAUDE.md → Dates). */
function whenMelbourne(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso)).replace(/\s?(am|pm)$/i, (m) => m.toLowerCase());
}

/** One drafted update: read it, change it if it doesn't sound like us, send it — or delete it. */
export default function UpdateCard({
  id, status, forDate, text, photoCount, woRef, jobTitle, jobStage = null, lastTickAt = null,
}: {
  id: string; status: string; forDate: string; text: string;
  photoCount: number; woRef: string; jobTitle: string;
  /** When the painter last ticked an area this draft was written from (ISO) — Tom, 14 Oct 2026. */
  lastTickAt?: string | null;
  /** The job's stage now — a draft on a closed job is too late to send (Tom, 29 Sep). */
  jobStage?: string | null;
}) {
  const [body, setBody] = useState(text);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState(status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * `becomes` is passed in rather than inferred from which action ran.
   *
   * This used to compare server-action references — `action === approveAndSend`
   * — which holds in a dev build and does NOT survive a production build, where
   * server actions compile to opaque references. The send worked and the card
   * never said so, which only showed up when the e2e ran against production.
   */
  function run(action: typeof approveUpdate, becomes: "approved" | "sent") {
    setMessage(null);
    startTransition(async () => {
      const result = await action({ updateId: id, text: editing ? body : undefined });
      if (result.ok) {
        setState(becomes);
        setEditing(false);
        setMessage(result.message ?? null);
      } else setMessage(result.message);
    });
  }

  return (
    <div className="card" data-testid={`update-${id}`}>
      <h3>
        {jobTitle || woRef}
        <em>{woRef} · {forDate}{jobStage === "closed" ? " · job completed" : ""}</em>
      </h3>
      <p className="note" data-testid={`ticked-${id}`}>
        {lastTickAt
          ? <>Painter&rsquo;s last update to this job: <b>{whenMelbourne(lastTickAt)}</b></>
          : <>No tick on record for this draft &mdash; it was written by hand or its ticks are gone.</>}
      </p>
      {jobStage === "closed" && state !== "sent" && state !== "deleted" && (
        <p className="note" style={{ color: "var(--amber)" }} data-testid={`too-late-${id}`}>
          This job has already completed — too late to send this one. Delete it.
        </p>
      )}

      {editing ? (
        <textarea className="edit" rows={12} value={body} data-testid={`edit-${id}`}
          onChange={(e) => setBody(e.target.value)} />
      ) : (
        <div className="draft" data-testid={`text-${id}`}>
          {body}
          {/* The composed text names its own photos; only a hand-written draft needs the count added. */}
          {photoCount > 0 && !/photo/i.test(body) && <> <b>Photos attached ({photoCount}).</b></>}
        </div>
      )}

      {message && <p className="note" data-testid={`msg-${id}`}>{message}</p>}

      <div className="row">
        {state === "sent" ? (
          <span className="btn done" data-testid={`sent-${id}`}>Sent ✓</span>
        ) : state === "deleted" ? (
          <span className="btn done" data-testid={`deleted-${id}`}>Deleted — not sent</span>
        ) : (
          <>
            <button type="button" className="btn primary" disabled={pending}
              onClick={() => run(approveAndSendUpdate, "sent")} data-testid={`send-${id}`}>
              {pending ? "Sending…" : "Approve & send"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing((e) => !e)}
              data-testid={`edit-toggle-${id}`}>
              {editing ? "Done editing" : "Edit"}
            </button>
            {/* Tom, 29 Sep: delete a draft that will never go. Two presses —
                the second confirms — so a stray tap never loses a draft. */}
            <button type="button" className={`btn ${confirmDelete ? "primary" : "dim"}`} disabled={pending}
              style={{ marginLeft: "auto" }} data-testid={`delete-${id}`}
              onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                setMessage(null);
                startTransition(async () => {
                  const r = await dismissUpdate({ updateId: id, reason: jobStage === "closed" ? "job already completed" : "" });
                  if (r.ok) { setState("deleted"); setMessage(r.message ?? null); }
                  else { setMessage(r.message); setConfirmDelete(false); }
                });
              }}>
              {pending && confirmDelete ? "Deleting…" : confirmDelete ? "Yes, delete it" : "Delete"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
