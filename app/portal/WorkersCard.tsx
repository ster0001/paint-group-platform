"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addWorkerAction, removeWorkerAction, resendWorkerLinkAction, shareJobAction } from "./workerActions";

/**
 * Your crew (induction Step 3a, rulings 13–15) — one component, two modes:
 *
 *   account  the Profile page: add a worker (name + mobile), text their login
 *            again, remove them
 *   job      a job page: a switch per worker — shared or not — plus the same
 *            add-a-worker row so a crew can be built on the spot
 *
 * A worker sees the jobs switched on here, the scope and the standards, and
 * ticks and photographs under their own name. They never see money, offers,
 * invoices, variations or messages — that is the login, not this card.
 */
export type WorkerSummary = { id: string; name: string; mobile: string; inductedAt: string | null; lastLinkSentAt: string | null; shared?: boolean };

export default function WorkersCard({ mode, workers, workOrderId = null }: {
  mode: "account" | "job";
  workers: WorkerSummary[];
  workOrderId?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function run(key: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(key); setMessage(null);
    const r = await fn();
    setBusy(null); setMessage(r.message);
    if (r.ok) { setName(""); setMobile(""); setAdding(false); router.refresh(); }
  }

  return (
    <div className="card" data-testid="workers-card" data-mode={mode}>
      <div className="tick-head"><b>Your crew</b><span className="tick-count">{workers.length} {workers.length === 1 ? "worker" : "workers"}</span></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {mode === "job"
          ? "Switch a worker on and they see this job on their own phone — the scope, the standards, photos and the tick list. Your price and the office stay with you."
          : "Each worker gets their own login by text. They see the jobs you share, tick their work under their own name and add photos. Nothing about money, offers or invoices."}
      </p>

      {workers.length > 0 && (
        <ul className="clean" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }} data-testid="workers-list">
          {workers.map((w) => (
            <li key={w.id} data-testid={`worker-${w.id}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 160px" }}>
                <b>{w.name}</b>
                <span className="hint" style={{ display: "block", padding: 0 }}>{w.mobile}{w.inductedAt ? " · inducted" : " · not inducted yet"}</span>
              </span>
              {mode === "job" && workOrderId ? (
                <button type="button" className={`btn narrow ${w.shared ? "cy" : "gh"}`} disabled={busy !== null}
                  onClick={() => run(w.id, () => shareJobAction({ workOrderId, contractorUserId: w.id, on: !w.shared }))}
                  data-testid={`worker-share-${w.id}`} aria-pressed={Boolean(w.shared)}>
                  {busy === w.id ? "…" : w.shared ? "Shared ✓" : "Share"}
                </button>
              ) : (
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn narrow gh" disabled={busy !== null}
                    onClick={() => run(w.id, () => resendWorkerLinkAction({ contractorUserId: w.id }))} data-testid={`worker-resend-${w.id}`}>
                    {busy === w.id ? "…" : "Send the link again"}
                  </button>
                  <button type="button" className="btn narrow gh" disabled={busy !== null}
                    onClick={() => { if (window.confirm(`Remove ${w.name} from your crew? Their login stops opening your jobs at once.`)) void run(w.id, () => removeWorkerAction({ contractorUserId: w.id })); }}
                    data-testid={`worker-remove-${w.id}`}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {message && <p className="tick-msg" role="status" data-testid="workers-message">{message}</p>}

      {adding ? (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }} data-testid="worker-add-form">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Worker's name" maxLength={120} data-testid="worker-name"
            style={{ fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--graphite)", color: "var(--text)" }} />
          <input type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile (the login link is texted here)" maxLength={40} data-testid="worker-mobile"
            style={{ fontSize: 14, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--graphite)", color: "var(--text)" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn narrow cy" disabled={busy !== null || !name.trim() || !mobile.trim()}
              onClick={() => run("add", () => addWorkerAction({ name, mobile }))} data-testid="worker-add-send">
              {busy === "add" ? "Adding…" : "Add and text the login"}
            </button>
            <button type="button" className="btn narrow gh" disabled={busy !== null} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn gh" style={{ marginTop: 10 }} onClick={() => setAdding(true)} data-testid="worker-add">
          Add a worker
        </button>
      )}
    </div>
  );
}
