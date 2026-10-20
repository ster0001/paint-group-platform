"use client";

import { useState, type ReactNode } from "react";

export type SavedView<F> = { id: string; name: string } & F;

export type SavedViewsProps<F extends object> = {
  /** The button's text. */
  label: ReactNode;
  /** The button reads muted when every lane is shown, coloured when a filter is on. */
  filtered: boolean;
  views: SavedView<F>[];
  /** The caller owns the list — it persists it wherever it lives. */
  onPersist: (views: SavedView<F>[]) => void;
  /** The filter state a saved view captures. */
  current: F;
  onApply: (view: F) => void;
  onClear: () => void;
  /** What `window.prompt` asks when saving. */
  promptText?: string;
  /** The filter controls themselves, between the saved views and Clear. */
  children?: ReactNode;
};

/**
 * The "who appears on the board" popover: saved views on top, the caller's
 * filter controls, Clear at the bottom. The filter PREDICATE is the caller's
 * (it knows what a lane is); this only holds the popover and the views.
 */
export function SavedViews<F extends object>({
  label, filtered, views, onPersist, current, onApply, onClear, promptText = "Name this view", children,
}: SavedViewsProps<F>) {
  const [open, setOpen] = useState(false);
  return (
    <div className="filters">
      <button className="seg" style={{ padding: "7px 10px", background: "none", border: "1px solid var(--line)", color: filtered ? "var(--cyan)" : "var(--muted)", borderRadius: 8, cursor: "pointer", fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase" }} onClick={() => setOpen((s) => !s)} data-testid="filters-open">
        {label}
      </button>
      {open && (
        <div className="fpop">
          <div className="lab">Saved views</div>
          {views.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>None yet.</div>}
          {views.map((v) => (
            <div className="viewrow" key={v.id}>
              <button className="pick" onClick={() => onApply(v)}>
                {v.name}
              </button>
              <button className="del" onClick={() => onPersist(views.filter((x) => x.id !== v.id))} aria-label={`Delete ${v.name}`}>✕</button>
            </div>
          ))}
          <button
            className="btn gh"
            style={{ marginTop: 8, padding: 8, fontSize: 12 }}
            onClick={() => {
              const name = window.prompt(promptText);
              if (!name?.trim()) return;
              onPersist([...views, { ...current, id: crypto.randomUUID(), name: name.trim() }]);
            }}
          >
            Save current as a view
          </button>

          {children}

          <button className="btn dim" style={{ padding: 8, fontSize: 12 }} onClick={onClear}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
