"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearNoWorkDayAction, setNoWorkDayAction } from "@/app/pc/noWorkActions";
import { MOMENT_LABEL, momentState, type MomentRow } from "@/lib/workorder/reminderMoments";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dmy = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };

/**
 * The job's reminder moments (Step 4) and the PC's "No work today" button
 * (R10): a rained-off day is marked, today or a past day, with a reason, and
 * its moments leave the count. The same control is on the schedule board.
 */
export default function NoWorkDay({ workOrderId, moments, flags }: {
  workOrderId: string; moments: MomentRow[]; flags: { day: string; reason: string }[];
}) {
  const router = useRouter();
  const [day, setDay] = useState(today());
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const now = new Date();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    setMsg(null); const r = await fn(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) router.refresh();
  });
  return (
    <div className="card" data-testid="reminder-moments">
      <h3>App updates <em>{moments.length ? `${moments.filter((m) => m.answeredAt).length} of ${moments.filter((m) => !m.skippedReason).length} answered` : "no moments yet"}</em></h3>
      <p className="note">The painter is texted at each moment and up to twice more that day until a tick or a photo lands. A day with no work is skipped and does not count.</p>
      {moments.map((m) => {
        const st = momentState(m, now);
        return (
          <div className="row" key={m.id} style={{ justifyContent: "space-between" }} data-testid={`moment-${m.kind}`} data-state={st}>
            <span>{MOMENT_LABEL[m.kind]} · {dmy(m.day)}</span>
            <span className={`pill ${st === "answered" ? "p-em" : st === "skipped" ? "" : st === "missed" ? "p-clay" : st === "due" ? "p-amber" : ""}`}>
              {st === "answered" ? "Answered" : st === "skipped" ? `Skipped — ${m.skippedReason === "no_work" ? "no work" : m.skippedReason === "rescheduled" ? "rebooked" : "not texted"}` : st === "missed" ? `Missed · ${m.sendsCount} text${m.sendsCount === 1 ? "" : "s"}` : st === "due" ? `Due today · ${m.sendsCount} sent` : "Upcoming"}
            </span>
          </div>
        );
      })}
      {flags.length > 0 && (
        <div className="row" style={{ flexDirection: "column", gap: 4 }} data-testid="no-work-days">
          {flags.map((f) => (
            <span key={f.day} className="note">No work {dmy(f.day)}{f.reason ? ` — ${f.reason}` : ""}{" "}
              <button type="button" className="btn dim" style={{ fontSize: 10, padding: "2px 8px" }} disabled={pending} data-testid={`no-work-clear-${f.day}`}
                onClick={() => run(() => clearNoWorkDayAction({ workOrderId, day: f.day }))}>Clear</button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="fld">No work on
          <input type="date" className="num" style={{ width: 150 }} value={day} max={today()} onChange={(e) => setDay(e.target.value)} data-testid="no-work-day" />
        </label>
        <input className="num" style={{ width: 220 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — rain, site locked…" data-testid="no-work-reason" />
        <button type="button" className="btn" disabled={pending || !day} data-testid="no-work-save"
          onClick={() => run(() => setNoWorkDayAction({ workOrderId, day, reason }))}>
          {pending ? "Saving…" : "No work that day"}
        </button>
      </div>
      {msg && <p className="note" style={{ color: msg.ok ? "var(--emerald)" : "var(--amber)" }} data-testid="no-work-msg">{msg.text}</p>}
    </div>
  );
}
