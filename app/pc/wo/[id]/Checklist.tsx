"use client";

import { useState, useTransition } from "react";
import { answerChecklistItem, tickChecklistItem } from "../../actions";

export type ChecklistItem = {
  id: string;
  label: string;
  detail: string;
  required: boolean;
  done: boolean;
  /** Derived items tick themselves from the data they read. */
  auto: string | null;
  /** tick = a box; yes_no = a question; note = a free-text box (completion prep). */
  kind?: "tick" | "yes_no" | "note";
  itemKey?: string | null;
  answer?: "yes" | "no" | null;
  answerNote?: string;
  /** A yes the office has already organised (rubbish / equipment). */
  handled?: boolean;
};

/**
 * A stage's checklist — the gate, made visible.
 *
 * Derived items (colours, quality checks) are shown but not tickable: they follow the thing
 * they read, and a checkbox that can disagree with the data is a lie waiting to
 * happen. Tapping one explains where to change it instead of failing silently.
 *
 * Completion prep carries QUESTIONS as well as ticks (Tom, 23 Aug): rubbish and
 * equipment for collection are yes/no, and there is a notes box for the
 * customer. The office can answer on the painter's behalf, and sees the answers.
 */
export default function Checklist({
  title, caption, items, outstanding, coloursHref, footer,
}: {
  title: string; caption: string; items: ChecklistItem[]; outstanding: number;
  /** The job sheet, opened at the colours. Omitted when there is no estimate. */
  coloursHref?: string;
  /** A line under the list — the prep list's scope confirmation. */
  footer?: string;
}) {
  const [rows, setRows] = useState(items);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i.id, i.answerNote ?? ""])),
  );

  function patch(id: string, p: Partial<ChecklistItem>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function tick(item: ChecklistItem) {
    setMessage(null);
    if (item.auto) {
      setMessage(item.auto === "colours"
        ? "This ticks itself once every colour on the job sheet is confirmed."
        : "This ticks itself once the quality checks are scheduled.");
      return;
    }
    // OPTIMISTIC (Tom, 25 Aug: "the lag when ticking") — the box flips the
    // instant it's tapped and reverts only if the server refuses. Ticks no
    // longer freeze the rest of the list either.
    patch(item.id, { done: !item.done });
    startTransition(async () => {
      const result = await tickChecklistItem({ itemId: item.id, done: !item.done });
      if (!result.ok) {
        patch(item.id, { done: item.done });
        setMessage(result.message);
      }
    });
  }

  function answer(item: ChecklistItem, value: "yes" | "no") {
    setMessage(null);
    const note = value === "yes" ? (drafts[item.id] ?? "") : "";
    if (item.itemKey === "equipment" && value === "yes" && note.trim().length === 0) {
      patch(item.id, { answer: "yes", done: false });
      return;
    }
    startTransition(async () => {
      const result = await answerChecklistItem({ itemId: item.id, answer: value, note });
      if (result.ok) patch(item.id, { answer: value, answerNote: note, done: true, handled: false });
      else setMessage(result.message);
    });
  }

  function saveNote(item: ChecklistItem) {
    setMessage(null);
    const note = drafts[item.id] ?? "";
    startTransition(async () => {
      const result = await answerChecklistItem({
        itemId: item.id, answer: item.kind === "yes_no" ? item.answer ?? undefined : undefined, note,
      });
      if (result.ok) patch(item.id, { answerNote: note, done: item.kind === "note" ? note.trim().length > 0 : true });
      else setMessage(result.message);
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

      {rows.map((item) => {
        const kind = item.kind ?? "tick";
        if (kind === "tick") {
          return (
            <button
              key={item.id}
              type="button"
              className={`chk ${item.done ? "on" : ""} ${item.auto ? "auto" : ""}`}
              onClick={() => tick(item)}
              disabled={false}
              data-testid={`chk-${item.id}`}
            >
              <span className="chk-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
              <span className="chk-body">
                <b>{item.label}{!item.required && <em> — optional</em>}</b>
                {item.detail && <small>{item.detail}</small>}
              </span>
              {item.auto && <span className="pill">auto</span>}
            </button>
          );
        }

        const needsList = kind === "yes_no" && item.itemKey === "equipment" && item.answer === "yes";
        return (
          <div key={item.id} className={`chk q ${item.done ? "on" : ""}`} data-testid={`chk-${item.id}`}>
            <span className="chk-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
            <span className="chk-body">
              <b>{item.label}{!item.required && <em> — optional</em>}</b>
              {item.detail && <small>{item.detail}</small>}
              {kind === "yes_no" && (
                <span className="row" style={{ marginTop: 6 }}>
                  <button type="button" className={`btn ${item.answer === "yes" ? "primary" : ""}`} disabled={pending}
                    onClick={() => answer(item, "yes")} data-testid={`chk-yes-${item.id}`}>Yes</button>
                  <button type="button" className={`btn ${item.answer === "no" ? "primary" : ""}`} disabled={pending}
                    onClick={() => answer(item, "no")} data-testid={`chk-no-${item.id}`}>No</button>
                  {item.answer === "yes" && item.itemKey !== "colours" && (
                    <span className={`pill ${item.handled ? "" : "p-am"}`} data-testid={`chk-handled-${item.id}`}>
                      {item.handled ? "organised" : "to organise — on the dashboard"}
                    </span>
                  )}
                  {item.answer === "no" && item.itemKey === "colours" && (
                    <span className="pill p-am" data-testid={`chk-colours-no-${item.id}`}>
                      colour matches needed — see the Colour matches card
                    </span>
                  )}
                </span>
              )}
              {(kind === "note" || needsList) && (
                <span style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  <textarea className="edit" rows={2} value={drafts[item.id] ?? ""}
                    placeholder={kind === "note" ? "Anything the customer should know" : "What needs collecting"}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                    data-testid={`chk-text-${item.id}`} />
                  <span className="row">
                    <button type="button" className="btn" disabled={pending}
                      onClick={() => saveNote(item)} data-testid={`chk-save-${item.id}`}>
                      {pending ? "Saving…" : "Save"}
                    </button>
                  </span>
                </span>
              )}
            </span>
          </div>
        );
      })}

      {/* The colours reminder used to be a dead end: it told you the colours
          weren't confirmed and gave you nowhere to go. This is the way in. */}
      {coloursHref && rows.some((r) => r.auto === "colours" && !r.done) && (
        <a className="btn cy" href={coloursHref} data-testid="set-colours"
          style={{ display: "inline-block", marginTop: 10 }}>
          Set the colours on the job sheet →
        </a>
      )}

      {footer && <p className="note" style={{ marginTop: 10 }} data-testid="checklist-footer">{footer}</p>}

      {rows.length === 0 && <p className="note">Nothing on this list.</p>}
    </div>
  );
}
