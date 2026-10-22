"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobTitle } from "../../actions";

/**
 * Tom, 22 Oct 2026: the job title on the working scope starts as the address and is the
 * office's to change — "43 Keith St — Exterior" and "43 Keith St — Interior" read apart.
 * Tap the title, type, Enter or Save; wo_set_job_title writes the snapshot's jobTitle.
 */
export default function JobTitle({ workOrderId, title }: { workOrderId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const next = draft.trim();
    if (!next || next === title) { setEditing(false); setDraft(title); return; }
    const r = await setJobTitle({ workOrderId, title: next });
    setMsg(r.ok ? null : r.message ?? "That did not save.");
    if (r.ok) { setEditing(false); router.refresh(); }
  });
  if (!editing) {
    return (
      <h2 data-testid="wo-title">
        {title}{" "}
        <button type="button" className="btn dim sm" style={{ verticalAlign: "middle", marginLeft: 6 }} onClick={() => { setDraft(title); setEditing(true); }} data-testid="wo-title-edit" title="Change the job title (Interior, Exterior, stage 2…)">✎</button>
      </h2>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input className="num" style={{ fontSize: 16, fontWeight: 700, minWidth: 260 }} value={draft} maxLength={120} autoFocus aria-label="Job title" data-testid="wo-title-input"
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setDraft(title); } }} />
      <button type="button" className="btn primary sm" disabled={pending} onClick={save} data-testid="wo-title-save">Save</button>
      <button type="button" className="btn dim sm" disabled={pending} onClick={() => { setEditing(false); setDraft(title); }}>Cancel</button>
      {msg && <span className="note" style={{ color: "var(--amber)" }}>{msg}</span>}
    </div>
  );
}
