"use client";

import { useState, useTransition } from "react";
import { removeSpec, saveSpecFromEstimate } from "./actions";

/**
 * Naming a job as a spec, and taking one off the list.
 *
 * Deliberately a NAME on a job the member already did, not a builder. Nobody
 * sits down to invent "end-of-lease repaint" in the abstract — they do the
 * job, notice they will do it forty more times, and name it. So the control
 * sits on the job, and the only thing it asks for is what to call it.
 */

export function SaveAsSpec({ estimateId, label }: { estimateId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [policy, setPolicy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (saved) return <div className="meta" data-testid={`spec-saved-${estimateId}`}>Saved as a spec ✓</div>;

  if (!open) {
    return (
      <button
        type="button"
        className="btn"
        style={{ padding: 10, fontSize: 14 }}
        data-testid={`save-spec-open-${estimateId}`}
        onClick={() => { setOpen(true); setName(label.slice(0, 60)); }}
      >
        Save these answers as a spec
      </button>
    );
  }

  return (
    <div style={{ width: "100%" }} data-testid={`save-spec-form-${estimateId}`}>
      <input
        className="field"
        value={name}
        maxLength={60}
        placeholder="e.g. End-of-lease repaint"
        aria-label="Spec name"
        data-testid={`save-spec-name-${estimateId}`}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="field"
        style={{ marginTop: 8 }}
        value={policy}
        maxLength={200}
        placeholder="Colours, in your words — optional"
        aria-label="Colour policy"
        onChange={(e) => setPolicy(e.target.value)}
      />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button
          type="button"
          className="btn btn-cyan"
          style={{ padding: 10, fontSize: 14 }}
          disabled={pending || name.trim() === ""}
          data-testid={`save-spec-submit-${estimateId}`}
          onClick={() => start(async () => {
            setError("");
            const r = await saveSpecFromEstimate({ estimateId, name: name.trim(), colourPolicy: policy.trim() });
            if (r.ok) setSaved(true); else setError(r.message);
          })}
        >{pending ? "Saving…" : "Save spec"}</button>
        <button type="button" className="btn" style={{ padding: 10, fontSize: 14 }} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <div className="meta" style={{ color: "var(--amber, #b45309)" }} data-testid={`save-spec-error-${estimateId}`}>{error}</div>}
    </div>
  );
}

export function RemoveSpec({ id, name }: { id: string; name: string }) {
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  if (gone) return <span className="chip mut nodot">Removed</span>;
  return (
    <button
      type="button"
      className="btn"
      style={{ padding: 8, fontSize: 13 }}
      disabled={pending}
      aria-label={`Remove ${name}`}
      data-testid={`remove-spec-${id}`}
      onClick={() => start(async () => { const r = await removeSpec(id); if (r.ok) setGone(true); })}
    >{pending ? "…" : "Remove"}</button>
  );
}
