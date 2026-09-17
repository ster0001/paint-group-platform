"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelTimeOffAction, requestTimeOffAction } from "./timeOffActions";

export type TimeOffRow = {
  id: string;
  kind: "leave" | "rdo" | "sick" | "other";
  start: string;
  end: string;
  reason: string;
  source: "contractor" | "staff";
  approvedAt: string | null;
  declinedAt: string | null;
  declineReason: string;
};

const dmy = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }).format(new Date(iso + "T00:00:00"));
const KIND_WORD: Record<TimeOffRow["kind"], string> = { leave: "Leave", rdo: "RDO", sick: "Sick", other: "Blocked" };

function statusOf(r: TimeOffRow): { cls: string; label: string } {
  if (r.source === "staff") return { cls: "gry", label: "By the office" };
  if (r.kind === "sick") return { cls: "cly", label: "Sick" };
  if (r.declinedAt) return { cls: "cly", label: "Declined" };
  if (r.approvedAt) return { cls: "grn", label: "Approved" };
  return { cls: "amb", label: "Requested" };
}

/**
 * Employed painters (Session 7, ruling 11): time off is ASKED FOR, not
 * blocked out. Leave and RDOs go to the office to approve; a sick day counts
 * at once and tells the office to reassign any booked day it lands on.
 */
export default function TimeOffCard({ rows, today }: { rows: TimeOffRow[]; today: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"leave" | "rdo" | "sick">("leave");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function submit() {
    setBusy(true); setErr(""); setDone("");
    const r = await requestTimeOffAction({ kind, start: kind === "sick" ? today : start, end: kind === "sick" ? today : end, reason });
    if (!r.ok) setErr(r.message);
    else {
      setDone(kind === "sick"
        ? "Marked sick for today — the office knows, and any job you were on today is theirs to reassign."
        : "Sent to the office — you'll see Approved or Declined here, and get a text.");
      setReason("");
    }
    setBusy(false);
    router.refresh();
  }

  async function cancel(id: string) {
    setBusy(true); setErr(""); setDone("");
    const r = await cancelTimeOffAction({ id });
    if (!r.ok) setErr(r.message);
    setBusy(false);
    router.refresh();
  }

  const upcoming = rows.filter((r) => r.end >= today).sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="card" data-testid="time-off-card">
      <h3>Time off</h3>
      <div style={{ fontSize: "12.5px", color: "var(--muted)", marginTop: 6 }}>
        Leave and RDOs go to the office to approve. Sick today? Mark it — it counts straight away.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {(["leave", "rdo", "sick"] as const).map((k) => (
          <button key={k} type="button" className={`btn ${kind === k ? "cy" : "gh"} narrow`} style={{ marginTop: 0 }}
            onClick={() => setKind(k)} data-testid={`time-off-kind-${k}`}>
            {k === "leave" ? "Leave" : k === "rdo" ? "RDO" : "Sick today"}
          </button>
        ))}
      </div>
      {kind !== "sick" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center", fontSize: "12.5px" }}>
          <label>From <input type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} data-testid="time-off-start" /></label>
          <label>To <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} data-testid="time-off-end" /></label>
        </div>
      )}
      <input type="text" placeholder={kind === "sick" ? "Anything the office should know (optional)" : "Why, in a few words (optional)"}
        value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="time-off-reason"
        style={{ width: "100%", marginTop: 8, fontSize: "13px", padding: "8px 10px", boxSizing: "border-box" }} />
      <button type="button" className="btn cy" disabled={busy} onClick={submit} data-testid="time-off-send">
        {busy ? "Saving…" : kind === "sick" ? "Mark me sick today" : "Ask the office"}
      </button>
      {done && <div className="ok" data-testid="time-off-done" style={{ marginTop: 8, fontSize: "12.5px" }}>{done}</div>}
      {err && <div className="err" data-testid="time-off-error" style={{ marginTop: 8 }}>{err}</div>}

      {upcoming.length > 0 && (
        <div style={{ marginTop: 12 }} data-testid="time-off-list">
          {upcoming.map((r) => {
            const s = statusOf(r);
            const cancellable = r.source === "contractor" && r.kind !== "other" && (r.kind === "sick" || r.start > today);
            return (
              <div className="act" key={r.id} data-testid={`time-off-${r.id}`}>
                <i aria-hidden>▦</i>
                <span>
                  {KIND_WORD[r.kind]} · {r.start === r.end ? dmy(r.start) : `${dmy(r.start)} → ${dmy(r.end)}`}
                  <br />
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                    {r.reason || ""}{r.declinedAt && r.declineReason ? `${r.reason ? " · " : ""}Office: ${r.declineReason}` : ""}
                  </span>
                </span>
                <span className="push" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <span className={`chip ${s.cls}`}>{s.label}</span>
                  {cancellable && (
                    <button type="button" className="btn gh narrow" style={{ marginTop: 0 }} disabled={busy}
                      onClick={() => cancel(r.id)} data-testid={`time-off-cancel-${r.id}`}>Cancel</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
