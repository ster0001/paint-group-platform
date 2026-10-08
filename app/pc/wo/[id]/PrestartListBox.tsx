"use client";

import { useState, useTransition } from "react";
import { savePrestartList } from "../../prestartActions";

/**
 * Tom, 8 Oct 2026: "boxes under the materials and equipment section in pre
 * start to be able to edit and save all of the equipment and materials
 * required for a job; this can be saved in the system before being marked as
 * yes so it's a reference point."
 *
 * One box per list, under its checklist item. Saving it is a reference only —
 * it never ticks the item; the tick above stays the gate.
 */
export default function PrestartListBox({ workOrderId, kind, initial }: {
  workOrderId: string; kind: "materials" | "equipment"; initial: string;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = text !== saved;

  const save = () => start(async () => {
    setMessage(null);
    const r = await savePrestartList({ workOrderId, kind, text });
    if (r.ok) { setSaved(text.trim()); setText(text.trim()); setMessage("Saved"); }
    else setMessage(r.message);
  });

  return (
    <div className="ps-list" data-testid={`prestart-list-${kind}`}>
      <textarea className="edit" rows={3} maxLength={4000} value={text}
        aria-label={kind === "materials" ? "Materials required for this job" : "Equipment required for this job"}
        placeholder={kind === "materials"
          ? "Every material this job needs — paint, primer, filler, caulk…"
          : "Every piece of equipment — ladders, scaffold, sprayer, drop sheets…"}
        onChange={(e) => { setText(e.target.value); setMessage(null); }}
        data-testid={`prestart-text-${kind}`} />
      <span className="row">
        <button type="button" className="btn" disabled={pending || !dirty} onClick={save}
          data-testid={`prestart-save-${kind}`}>
          {pending ? "Saving…" : kind === "materials" ? "Save materials list" : "Save equipment list"}
        </button>
        {message && (
          <span className="note" style={{ color: message === "Saved" ? "var(--emerald)" : "var(--amber)" }}
            data-testid={`prestart-msg-${kind}`}>{message}</span>
        )}
      </span>
    </div>
  );
}
