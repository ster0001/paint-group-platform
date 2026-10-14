"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestNoWorkDayAction } from "./gapActions";

export type NoWorkFlagRow = { id: string; day: string; flag: "no_work" | "no_work_requested" | "no_work_declined"; reason: string };

const melbToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dmy = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };
const REASONS = ["Rained off", "Site not ready", "Sick", "No materials yet", "Other"];

/**
 * "Rained off / no work today" from the painter's side (induction brief §6,
 * R10, Module 10): tell Paint Group in the morning; when the office confirms,
 * no reminder counts for that day. A day you do not work is not held against
 * you — if we know.
 */
export default function NoWorkToday({ workOrderId, flags, canRequest }: { workOrderId: string; flags: NoWorkFlagRow[]; canRequest: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const today = melbToday();

  async function send() {
    setBusy(true); setMessage(null);
    const r = await requestNoWorkDayAction({ workOrderId, day: today, reason });
    setBusy(false); setMessage(r.message);
    if (r.ok) { setOpen(false); router.refresh(); }
  }

  return (
    <div className="card" data-testid="no-work-today">
      <div className="tick-head"><b>Not working today?</b></div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>Rained off, site locked, nothing to do? Tell Paint Group in the morning and the day is not held against you.</p>
      {flags.length > 0 && (
        <ul className="clean" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }} data-testid="no-work-flags">
          {flags.map((f) => (
            <li key={f.id} data-testid={`no-work-flag-${f.id}`} data-flag={f.flag} style={{ fontSize: 12.5, color: f.flag === "no_work_declined" ? "var(--amber)" : "var(--text)" }}>
              {dmy(f.day)} — {f.flag === "no_work" ? "marked no work" : f.flag === "no_work_requested" ? "sent to the office, waiting" : "the office kept it as a work day"}{f.reason ? ` (${f.reason})` : ""}
            </li>
          ))}
        </ul>
      )}
      {message && <p className="tick-msg" role="status" data-testid="no-work-msg">{message}</p>}
      {canRequest && (open ? (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="no-work-reasons">
            {REASONS.map((r) => (
              <button key={r} type="button" className={`btn narrow ${reason === r ? "cy" : "gh"}`} onClick={() => setReason(r)} data-testid={`no-work-reason-${r.toLowerCase().replace(/\s+/g, "-")}`}>{r}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn narrow cy" disabled={busy} onClick={() => void send()} data-testid="no-work-send">{busy ? "Sending…" : `No work today (${dmy(today)})`}</button>
            <button type="button" className="btn narrow gh" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn gh" style={{ marginTop: 10 }} onClick={() => { setOpen(true); setMessage(null); }} data-testid="no-work-open">No work today</button>
      ))}
    </div>
  );
}
