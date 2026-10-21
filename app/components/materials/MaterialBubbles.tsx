"use client";

import { useState } from "react";

/**
 * Materials as bubbles (Tom, 21 Oct 2026): one bubble per order line, like the tags on the
 * paint categories tab. Tap the words to edit the line in place, × removes it, and a bubble
 * with several comma-separated items shows each item with its own × that SPLITS that item
 * off into its own line (its own chip) — tapes out of stock, the rest of the order unchanged.
 *
 * Two flavours over one look: `MaterialBubbles` is the saved list (the job page, Sources, the
 * chip sheet) where every change is an action; `BubbleInput` is the estimate builder's draft
 * (a plain string array in the builder state, saved with the estimate).
 */
export type Bubble = {
  id: string;
  text: string;
  /** The small print after the words: where it came from, where its chip is. */
  sub?: string | null;
  /** On someone's day already — the × and the split are off, editing still works. */
  locked?: boolean;
};

export function splitItems(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter(Boolean);
}

export function MaterialBubbles({ bubbles, busy, onEdit, onRemove, onSplit, testId = "material-bubble" }: {
  bubbles: Bubble[];
  busy: boolean;
  onEdit: (id: string, text: string) => void | Promise<unknown>;
  onRemove: (id: string) => void | Promise<unknown>;
  /** One item off a multi-item bubble → its own line. Absent = no per-item ×. */
  onSplit?: (id: string, item: string) => void | Promise<unknown>;
  testId?: string;
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const commit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    const was = bubbles.find((b) => b.id === editing.id)?.text ?? "";
    setEditing(null);
    if (text && text !== was) void onEdit(editing.id, text);
  };
  return (
    <div className="bubbles" data-testid="material-bubbles">
      {bubbles.map((b) => {
        const items = splitItems(b.text);
        if (editing?.id === b.id) {
          return (
            <span key={b.id} className="bubble editing" data-testid={testId} data-line-id={b.id}>
              <input type="text" value={editing.text} maxLength={500} autoFocus aria-label="Edit the line" data-testid="bubble-edit"
                onChange={(e) => setEditing({ id: b.id, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }}
                onBlur={commit} />
            </span>
          );
        }
        return (
          <span key={b.id} className={`bubble${b.locked ? " locked" : ""}`} data-testid={testId} data-line-id={b.id} data-items={String(items.length)}>
            <button type="button" className="words" disabled={busy} title="Tap to edit" onClick={() => setEditing({ id: b.id, text: b.text })} data-testid="bubble-words">
              {onSplit && items.length > 1
                ? items.map((it, i) => (
                  <span key={`${it}:${i}`} className="item" data-testid="bubble-item">
                    {it}
                    <span role="button" tabIndex={0} className="ix" aria-label={`Split ${it} into its own order`} title={b.locked ? "On someone's day — bring the chip back to the tray first" : `Take ${it} off this order into its own chip`}
                      data-testid="bubble-item-split"
                      onClick={(e) => { e.stopPropagation(); if (!b.locked && !busy) void onSplit(b.id, it); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!b.locked && !busy) void onSplit(b.id, it); } }}>×</span>
                  </span>
                ))
                : b.text}
            </button>
            {b.sub && <small>{b.sub}</small>}
            <button type="button" className="x" disabled={busy || b.locked} aria-label={`Remove ${b.text}`} title={b.locked ? "On someone's day — bring the chip back to the tray first" : "Remove this line"}
              onClick={() => void onRemove(b.id)} data-testid="bubble-remove">×</button>
          </span>
        );
      })}
    </div>
  );
}

/** The builder's draft list: Enter (or comma-free paste + Add) makes a bubble; × removes; tap edits. */
export function BubbleInput({ value, onChange, disabled, placeholder, inputTestId = "bubble-input", label }: {
  value: string[]; onChange: (next: string[]) => void; disabled?: boolean; placeholder?: string; inputTestId?: string; label: string;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...value, t.slice(0, 500)]);
    setDraft("");
  };
  const commit = () => {
    if (!editing) return;
    const t = editing.text.trim();
    const next = value.slice();
    if (t) next[editing.i] = t.slice(0, 500); else next.splice(editing.i, 1);
    setEditing(null);
    onChange(next);
  };
  return (
    <div className="bubbles-input" data-testid="bubble-input-box">
      <div className="bubbles">
        {value.map((t, i) => editing?.i === i ? (
          <span key={i} className="bubble editing" data-testid="draft-bubble">
            <input type="text" value={editing.text} maxLength={500} autoFocus aria-label="Edit the line" onChange={(e) => setEditing({ i, text: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setEditing(null); }} onBlur={commit} />
          </span>
        ) : (
          <span key={i} className="bubble" data-testid="draft-bubble">
            <button type="button" className="words" disabled={disabled} title="Tap to edit" onClick={() => setEditing({ i, text: t })}>{t}</button>
            <button type="button" className="x" disabled={disabled} aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((_, j) => j !== i))} data-testid="draft-bubble-remove">×</button>
          </span>
        ))}
      </div>
      <div className="addrow">
        <input type="text" value={draft} maxLength={500} disabled={disabled} placeholder={placeholder} aria-label={label} data-testid={inputTestId}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" disabled={disabled || !draft.trim()} onClick={add} data-testid={`${inputTestId}-add`}>Add</button>
      </div>
    </div>
  );
}
