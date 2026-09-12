"use client";

import { useState } from "react";

export default function TenantUpload({ token, already }: { token: string; already: number }) {
  const [count, setCount] = useState(already);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function onPick(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true); setNote(null);
    const fd = new FormData();
    for (const f of Array.from(files).slice(0, 12)) fd.append("photos", f, f.name);
    try {
      const res = await fetch(`/api/tenant/${token}`, { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { kept?: number; total?: number; error?: string };
      if (!res.ok) { setNote(j.error ?? "That didn't send — try again."); return; }
      setCount(j.total ?? count + (j.kept ?? 0));
      setNote(`${j.kept ?? 0} photo${j.kept === 1 ? "" : "s"} sent. Thank you — that's all we need.`);
    } catch {
      setNote("That didn't send — check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label style={{ display: "block", padding: "16px 14px", border: "2px dashed #94a3b8", borderRadius: 12, textAlign: "center", cursor: "pointer", background: "#f8fafc" }}>
        <input type="file" accept="image/*" multiple capture="environment" style={{ display: "none" }} disabled={busy} onChange={(e) => onPick(e.target.files)} data-testid="tenant-file" />
        <div style={{ fontWeight: 700 }}>{busy ? "Sending…" : "Take or choose photos"}</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Up to 12 at a time. From the doorway is fine.</div>
      </label>
      {count > 0 && <p style={{ marginTop: 10 }} data-testid="tenant-count">{count} photo{count === 1 ? "" : "s"} on file.</p>}
      {note && <p role="status" style={{ marginTop: 8, color: "#334155" }} data-testid="tenant-note">{note}</p>}
    </div>
  );
}
