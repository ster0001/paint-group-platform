"use client";

import { useState, useTransition } from "react";
import { CORRECTION_REASONS, REASON_LABEL, type Correction, type CorrectionReason } from "@/lib/wizard/correction";
import { saveCorrectionAction } from "./actions";

/**
 * One Proving row's "why did you change it" control (Phase 3, 6 Sep plan).
 * Collapsed it shows the tags as chips; open it is a chip picker and a note.
 */
export default function CorrectionTags({ estimateId, initial }: { estimateId: string; initial: Correction | null }) {
  const [saved, setSaved] = useState<Correction | null>(initial);
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<CorrectionReason[]>(initial?.reasons ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const toggle = (r: CorrectionReason) => setReasons((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));
  const save = () => start(async () => {
    const res = await saveCorrectionAction({ estimateId, reasons, note });
    if (res.status === "error") { setMsg(res.message); return; }
    setSaved(res.correction);
    setMsg("Saved ✓");
    setOpen(false);
  });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-1" data-testid={`correction-${estimateId}`}>
        {saved?.reasons.map((r) => (
          <span key={r} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800" data-testid="correction-chip">{REASON_LABEL[r]}</span>
        ))}
        {saved?.note && <span className="text-xs text-gray-500" title={saved.note}>“{saved.note.slice(0, 40)}{saved.note.length > 40 ? "…" : ""}”</span>}
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-gray-500 underline hover:text-gray-800" data-testid="correction-open">
          {saved ? "Edit" : "Why did it change?"}
        </button>
        {msg && <span className="text-xs text-gray-400">{msg}</span>}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid={`correction-${estimateId}`}>
      <div className="flex flex-wrap gap-1">
        {CORRECTION_REASONS.map(([r, label]) => (
          <button key={r} type="button" onClick={() => toggle(r)} aria-pressed={reasons.includes(r)}
            className={`rounded border px-2 py-0.5 text-xs ${reasons.includes(r) ? "border-amber-500 bg-amber-50 text-amber-900" : "border-gray-200 text-gray-600 hover:border-gray-400"}`}>
            {label}
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} placeholder="One line — e.g. no ensuite or WC in the list"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs" data-testid="correction-note" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending || (reasons.length === 0 && !note.trim())}
          className="rounded bg-gray-900 px-2 py-1 text-xs text-white disabled:opacity-40" data-testid="correction-save">{pending ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 underline">Cancel</button>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>
    </div>
  );
}
