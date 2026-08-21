"use client";

import { useState, useTransition } from "react";
import { approveAndSendUpdate, approveUpdate } from "../actions";

/** One drafted update: read it, change it if it doesn't sound like us, send it. */
export default function UpdateCard({
  id, status, forDate, text, photoCount, woRef, jobTitle,
}: {
  id: string; status: string; forDate: string; text: string;
  photoCount: number; woRef: string; jobTitle: string;
}) {
  const [body, setBody] = useState(text);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState(status);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: typeof approveUpdate) {
    setMessage(null);
    startTransition(async () => {
      const result = await action({ updateId: id, text: editing ? body : undefined });
      if (result.ok) {
        setState(action === approveAndSendUpdate ? "sent" : "approved");
        setEditing(false);
        setMessage(result.message ?? null);
      } else setMessage(result.message);
    });
  }

  return (
    <div className="card" data-testid={`update-${id}`}>
      <h3>
        {jobTitle || woRef}
        <em>{woRef} · {forDate}</em>
      </h3>

      {editing ? (
        <textarea className="edit" rows={5} value={body} data-testid={`edit-${id}`}
          onChange={(e) => setBody(e.target.value)} />
      ) : (
        <div className="draft" data-testid={`text-${id}`}>
          {body}
          {photoCount > 0 && <> <b>Photos attached ({photoCount}).</b></>}
        </div>
      )}

      {message && <p className="note" data-testid={`msg-${id}`}>{message}</p>}

      <div className="row">
        {state === "sent" ? (
          <span className="btn done" data-testid={`sent-${id}`}>Sent ✓</span>
        ) : (
          <>
            <button type="button" className="btn primary" disabled={pending}
              onClick={() => run(approveAndSendUpdate)} data-testid={`send-${id}`}>
              {pending ? "Sending…" : "Approve & send"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing((e) => !e)}
              data-testid={`edit-toggle-${id}`}>
              {editing ? "Done editing" : "Edit"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
