"use client";

import { useState, useTransition } from "react";
import { tickPrepItem } from "./tickActions";

export type PrepItem = { id: string; label: string; detail: string; required: boolean; done: boolean };

/**
 * Completion prep, on the painter's phone.
 *
 * The lifecycle mockup puts this in the contractor's lane — it is the last pass
 * before the customer walks through, and the person who did the work is the one
 * who can say it is done. Ticking the last item is what tells the office the job
 * is ready to hand over.
 */
export default function PrepChecklist({ items }: { items: PrepItem[] }) {
  const [rows, setRows] = useState(items);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const left = rows.filter((r) => r.required && !r.done).length;

  function tick(item: PrepItem) {
    setMessage(null);
    startTransition(async () => {
      const result = await tickPrepItem({ itemId: item.id, done: !item.done });
      if (result.ok) setRows((rs) => rs.map((r) => (r.id === item.id ? { ...r, done: !r.done } : r)));
      else setMessage(result.message);
    });
  }

  return (
    <div className="card" style={{ marginTop: 12 }} data-testid="prep-checklist">
      <div className="tick-head">
        <b>Completion prep</b>
        <span className="tick-count" data-testid="prep-count">
          {left === 0 ? "all done" : `${left} to go`}
        </span>
      </div>

      {message && <p className="tick-msg" role="status" data-testid="prep-message">{message}</p>}

      {rows.map((item) => (
        <button key={item.id} type="button" className={`prep ${item.done ? "on" : ""}`}
          onClick={() => tick(item)} disabled={pending} data-testid={`prep-${item.id}`}>
          <span className="prep-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
          <span className="prep-body">
            <b>{item.label}</b>
            {item.detail && <small>{item.detail}</small>}
          </span>
        </button>
      ))}

      {left === 0 && rows.length > 0 && (
        <p className="note" data-testid="prep-done">
          That&rsquo;s everything. The office will send the customer their walkthrough.
        </p>
      )}
    </div>
  );
}
