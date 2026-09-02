"use client";

import { useState, useTransition } from "react";
import { saveBrainEntryAction } from "./brainActions";

export type BrainRow = { id: string; slug: string | null; topic: string; question: string; answer_md: string; audience: "customer" | "staff" | "both"; status: "draft" | "approved"; needs_content: boolean };

/** Approve per entry; edit the answer; the unwritten ones are called out. */
export default function BrainManager({ rows }: { rows: BrainRow[] }) {
  const [items, setItems] = useState(rows);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const patch = (id: string, p: Partial<BrainRow>) => setItems((all) => all.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const save = (r: BrainRow, extra: { status?: "draft" | "approved" } = {}) => start(async () => {
    const res = await saveBrainEntryAction({ id: r.id, status: extra.status ?? r.status, answerMd: r.answer_md, audience: r.audience, needsContent: r.needs_content });
    setMsg(res.ok ? "Saved." : res.message);
    if (res.ok && extra.status) patch(r.id, { status: extra.status });
  });

  const groups = [...new Set(items.map((r) => r.topic))];
  return (
    <div className="brain">
      <p className="sub">Only <strong>approved</strong> entries are ever used in an answer. Entries marked <em>to write</em> hold a placeholder and are treated as absent — the assistant says “no entry yet, want a person?”. Tokens like <code>{"{{deposit_pct}}"}</code> render the live Settings value.</p>
      {msg && <p className="sub" role="status">{msg}</p>}
      {groups.map((topic) => (
        <section key={topic} style={{ marginTop: 14 }}>
          <h3 style={{ margin: "0 0 6px" }}>{topic}</h3>
          {items.filter((r) => r.topic === topic).map((r) => (
            <div key={r.id} className="card" style={{ marginBottom: 8 }} data-slug={r.slug ?? ""}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{r.question}</strong>
                <span className={`pill ${r.status === "approved" ? "ok" : ""}`}>{r.status}</span>
                {r.needs_content && <span className="pill warn">to write</span>}
                <span className="sub">{r.audience}</span>
              </div>
              <textarea value={r.answer_md} rows={Math.min(8, Math.max(2, r.answer_md.split("\n").length + 1))} style={{ width: "100%", marginTop: 6 }} onChange={(e) => patch(r.id, { answer_md: e.target.value })} aria-label={`Answer: ${r.question}`} />
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <select value={r.audience} onChange={(e) => patch(r.id, { audience: e.target.value as BrainRow["audience"] })} aria-label="Audience">
                  <option value="customer">customer</option><option value="staff">staff</option><option value="both">both</option>
                </select>
                <label className="sub"><input type="checkbox" checked={r.needs_content} onChange={(e) => patch(r.id, { needs_content: e.target.checked })} /> still to write</label>
                <button type="button" className="btn" disabled={pending} onClick={() => save(r)}>Save</button>
                {r.status === "approved"
                  ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => save(r, { status: "draft" })}>Back to draft</button>
                  : <button type="button" className="btn btn-cyan" disabled={pending || r.needs_content} onClick={() => save(r, { status: "approved" })}>Approve</button>}
              </div>
            </div>
          ))}
        </section>
      ))}
      {items.length === 0 && <p className="sub">No entries yet — run <code>npx tsx scripts/import-brain.ts</code> to load the seed as drafts.</p>}
    </div>
  );
}
