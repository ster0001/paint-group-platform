"use client";

import { useState, useTransition } from "react";
import { answerPrepItem, tickPrepItem } from "./tickActions";

export type PrepItem = {
  id: string; label: string; detail: string; required: boolean; done: boolean;
  /** tick = a box; yes_no = a question; note = a free-text box. */
  kind: "tick" | "yes_no" | "note";
  itemKey: string | null;
  answer: "yes" | "no" | null;
  answerNote: string;
};

/**
 * Completion prep, on the painter's phone (Tom, 23 Aug):
 *
 *   Touch-up sweep done · Site left clean · Rubbish for collection? (yes/no —
 *   yes prompts the office) · Equipment for collection? (yes/no — yes needs
 *   the list) · Final photos taken · All work completed to the level required ·
 *   Any notes for the customer.
 *
 * Ticking the list is the painter's confirmation that the work has been done
 * to the required scope — the line under the list says so in as many words.
 */
export default function PrepChecklist({ items }: { items: PrepItem[] }) {
  const [rows, setRows] = useState(items);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Draft text per item, so typing doesn't round-trip on every keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i.id, i.answerNote])),
  );

  const left = rows.filter((r) => r.required && !r.done).length;

  function patch(id: string, p: Partial<PrepItem>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  function tick(item: PrepItem) {
    setMessage(null);
    // OPTIMISTIC (Tom, 25 Aug): the box flips the instant it's tapped and
    // reverts only if the server refuses — a painter clicks through the list
    // at their own speed, not the network's.
    patch(item.id, { done: !item.done });
    startTransition(async () => {
      const result = await tickPrepItem({ itemId: item.id, done: !item.done });
      if (!result.ok) {
        patch(item.id, { done: item.done });
        setMessage(result.message);
      }
    });
  }

  function answer(item: PrepItem, value: "yes" | "no") {
    setMessage(null);
    const note = value === "yes" ? (drafts[item.id] ?? "") : "";
    // Equipment yes needs the list: open the box first, save when it has words.
    if (item.itemKey === "equipment" && value === "yes" && note.trim().length === 0) {
      patch(item.id, { answer: "yes", done: false });
      return;
    }
    startTransition(async () => {
      const result = await answerPrepItem({ itemId: item.id, answer: value, note });
      if (result.ok) patch(item.id, { answer: value, answerNote: note, done: true });
      else setMessage(result.message);
    });
  }

  function saveNote(item: PrepItem) {
    setMessage(null);
    const note = drafts[item.id] ?? "";
    startTransition(async () => {
      const result = await answerPrepItem({
        itemId: item.id, answer: item.kind === "yes_no" ? item.answer ?? undefined : undefined, note,
      });
      if (result.ok) patch(item.id, { answerNote: note, done: item.kind === "note" ? note.trim().length > 0 : true });
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

      {rows.map((item) => {
        if (item.kind === "tick") {
          return (
            <button key={item.id} type="button" className={`prep ${item.done ? "on" : ""}`}
              onClick={() => tick(item)} data-testid={`prep-${item.id}`}>
              <span className="prep-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
              <span className="prep-body">
                <b>{item.label}</b>
                {item.detail && <small>{item.detail}</small>}
              </span>
            </button>
          );
        }

        if (item.kind === "yes_no") {
          const needsList = item.itemKey === "equipment" && item.answer === "yes";
          return (
            <div key={item.id} className={`prep q ${item.done ? "on" : ""}`} data-testid={`prep-${item.id}`}>
              <span className="prep-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
              <span className="prep-body">
                <b>{item.label}</b>
                {item.detail && <small>{item.detail}</small>}
                <span className="prep-yn">
                  <button type="button" className={`btn narrow ${item.answer === "yes" ? "cy" : "gh"}`}
                    disabled={pending} onClick={() => answer(item, "yes")}
                    data-testid={`prep-yes-${item.id}`}>Yes</button>
                  <button type="button" className={`btn narrow ${item.answer === "no" ? "cy" : "gh"}`}
                    disabled={pending} onClick={() => answer(item, "no")}
                    data-testid={`prep-no-${item.id}`}>No</button>
                </span>
                {item.answer === "yes" && item.itemKey === "rubbish" && (
                  <small data-testid={`prep-rubbish-note-${item.id}`}>
                    Thanks — the office has been told and will organise the collection.
                  </small>
                )}
                {needsList && (
                  <span className="prep-note">
                    <textarea rows={2} value={drafts[item.id] ?? ""} placeholder="What needs collecting? e.g. 2 ladders, the sprayer"
                      onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                      data-testid={`prep-list-${item.id}`} />
                    <button type="button" className="btn narrow gh" disabled={pending}
                      onClick={() => saveNote(item)} data-testid={`prep-save-${item.id}`}>
                      {pending ? "Saving…" : "Save list"}
                    </button>
                    {item.answerNote.trim().length === 0 && (
                      <small style={{ color: "var(--amber)" }}>List what needs collecting — the office needs it to book the pickup.</small>
                    )}
                  </span>
                )}
              </span>
            </div>
          );
        }

        // note
        return (
          <div key={item.id} className={`prep q ${item.done ? "on" : ""}`} data-testid={`prep-${item.id}`}>
            <span className="prep-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
            <span className="prep-body">
              <b>{item.label}{!item.required && <small> (optional)</small>}</b>
              {item.detail && <small>{item.detail}</small>}
              <span className="prep-note">
                <textarea rows={3} value={drafts[item.id] ?? ""}
                  placeholder="Anything the customer should know — e.g. keep windows closed till the morning"
                  onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                  data-testid={`prep-note-${item.id}`} />
                <button type="button" className="btn narrow gh" disabled={pending}
                  onClick={() => saveNote(item)} data-testid={`prep-save-${item.id}`}>
                  {pending ? "Saving…" : "Save note"}
                </button>
              </span>
            </span>
          </div>
        );
      })}

      <p className="hint" style={{ padding: 0, marginTop: 10 }} data-testid="prep-confirmation">
        Ticking this list is your confirmation that the work has been completed to the
        scope and standard on the job sheet.
      </p>

      {left === 0 && rows.length > 0 && (
        <p className="note" data-testid="prep-done">
          That&rsquo;s everything. Press &ldquo;All done — next step&rdquo; below to send the job on.
        </p>
      )}
    </div>
  );
}
