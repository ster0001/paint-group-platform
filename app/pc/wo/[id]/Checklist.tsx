"use client";

import { useState, useTransition } from "react";
import { tickChecklistItem } from "../../actions";

export type ChecklistItem = {
  id: string;
  label: string;
  detail: string;
  required: boolean;
  done: boolean;
  /** Derived items tick themselves from the data they read. */
  auto: string | null;
};

/**
 * A stage's checklist — the gate, made visible.
 *
 * Derived items (colours, quality checks) are shown but not tickable: they follow the thing
 * they read, and a checkbox that can disagree with the data is a lie waiting to
 * happen. Tapping one explains where to change it instead of failing silently.
 */
export default function Checklist({
  title, caption, items, outstanding, coloursHref,
}: {
  title: string; caption: string; items: ChecklistItem[]; outstanding: number;
  /** The job sheet, opened at the colours. Omitted when there is no estimate. */
  coloursHref?: string;
}) {
  const [rows, setRows] = useState(items);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function tick(item: ChecklistItem) {
    setMessage(null);
    if (item.auto) {
      setMessage(item.auto === "colours"
        ? "This ticks itself once every colour on the job sheet is confirmed."
        : "This ticks itself once the quality checks are scheduled.");
      return;
    }
    startTransition(async () => {
      const result = await tickChecklistItem({ itemId: item.id, done: !item.done });
      if (result.ok) {
        setRows((rs) => rs.map((r) => (r.id === item.id ? { ...r, done: !r.done } : r)));
      } else setMessage(result.message);
    });
  }

  return (
    <div className="card" data-testid={`checklist-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <h3>
        {title}
        <em>{outstanding === 0 ? "all done" : `${outstanding} to go`}</em>
      </h3>
      <p className="note">{caption}</p>

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid="checklist-message">{message}</p>}

      {rows.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`chk ${item.done ? "on" : ""} ${item.auto ? "auto" : ""}`}
          onClick={() => tick(item)}
          disabled={pending}
          data-testid={`chk-${item.id}`}
        >
          <span className="chk-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
          <span className="chk-body">
            <b>{item.label}{!item.required && <em> — optional</em>}</b>
            {item.detail && <small>{item.detail}</small>}
          </span>
          {item.auto && <span className="pill">auto</span>}
        </button>
      ))}

      {/* The colours reminder used to be a dead end: it told you the colours
          weren't confirmed and gave you nowhere to go. This is the way in. */}
      {coloursHref && rows.some((r) => r.auto === "colours" && !r.done) && (
        <a className="btn cy" href={coloursHref} data-testid="set-colours"
          style={{ display: "inline-block", marginTop: 10 }}>
          Set the colours on the job sheet →
        </a>
      )}

      {rows.length === 0 && <p className="note">Nothing on this list.</p>}
    </div>
  );
}
