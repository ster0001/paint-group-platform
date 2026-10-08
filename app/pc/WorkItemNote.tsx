"use client";

import { useState, useTransition } from "react";
import { saveWorkItemNote } from "./prestartActions";

/**
 * A short note on one dashboard reminder (Tom, 8 Oct 2026: "quick short
 * reminder notes on each reminder"). Keyed by the reminder's own derived key,
 * so it is there next time the same reminder is drawn. Compact by default: the
 * saved note as one line, or a small "+ note" until there is one.
 */
export default function WorkItemNote({ itemKey, initial }: { itemKey: string; initial: string }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    setMessage(null);
    const r = await saveWorkItemNote({ itemKey, note: draft.trim() });
    if (r.ok) { setSaved(draft.trim()); setOpen(false); }
    else setMessage(r.message);
  });

  return (
    <div className="wi-note" data-testid={`note-${itemKey}`}>
      {open ? (
        <span className="wi-note-edit">
          <input className="edit" type="text" maxLength={280} value={draft} autoFocus
            placeholder="A quick note — who you rang, what's next"
            aria-label="Note on this reminder"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setDraft(saved); setOpen(false); } }}
            data-testid={`note-text-${itemKey}`} />
          <button type="button" className="btn" disabled={pending} onClick={save} data-testid={`note-save-${itemKey}`}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn dim" disabled={pending}
            onClick={() => { setDraft(saved); setOpen(false); setMessage(null); }}>Cancel</button>
        </span>
      ) : saved ? (
        <button type="button" className="wi-note-shown" onClick={() => setOpen(true)} title="Edit note"
          data-testid={`note-open-${itemKey}`}>
          <span aria-hidden="true">✎ </span><span data-testid={`note-shown-${itemKey}`}>{saved}</span>
        </button>
      ) : (
        <button type="button" className="wi-note-add" onClick={() => setOpen(true)} data-testid={`note-open-${itemKey}`}>
          + note
        </button>
      )}
      {message && <span className="note" style={{ color: "var(--amber)" }} data-testid={`note-msg-${itemKey}`}>{message}</span>}
    </div>
  );
}
