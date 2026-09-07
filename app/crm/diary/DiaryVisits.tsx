"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { VISIT_KINDS, STATUS_LABEL, type VisitRow } from "@/lib/visits/types";
import { moveVisitAction, visitOutcomeAction } from "./actions";
import { melbourneInstantFromLocal, melbourneLocalParts } from "./time";

export type Lane = { staffId: string | null; name: string; takesVisits: boolean };
/** An entry from the estimator's own Google calendars (8 Sep) — shown, never editable here. */
export type GoogleEntry = { staffId: string; startsAt: string; endsAt: string; label: string; calendar: string; allDay: boolean };

/**
 * The Diary's first section (P6): estimator visits, one lane per estimator,
 * with the outcomes a person records in one click — done, no show, rebook —
 * and a move. Nothing here computes availability; the server did that, and
 * the database refuses a double-booking whatever the form says.
 */
export default function DiaryVisits({ lanes, visits, days, google = [] }: { lanes: Lane[]; visits: VisitRow[]; days: string[]; google?: GoogleEntry[] }) {
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();
  const [moving, setMoving] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<{ id: string; status: "done" | "no_show" } | null>(null);
  const [note, setNote] = useState("");

  const run = (work: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => { const r = await work(); setSaid(r); if (r.ok) { setMoving(null); setOutcomeFor(null); setNote(""); } });

  const byLane = new Map<string, VisitRow[]>();
  for (const v of visits) {
    const key = v.staff_id ?? "none";
    byLane.set(key, [...(byLane.get(key) ?? []), v]);
  }
  const laneList: Lane[] = [...lanes.filter((l) => l.takesVisits || byLane.has(l.staffId ?? "none")), ...(byLane.has("none") ? [{ staffId: null, name: "Unassigned", takesVisits: false }] : [])];
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit" });
  const dayOf = (iso: string) => melbourneLocalParts(iso).date;
  // A Google entry belongs to every day it touches (leave spans days).
  const googleOn = (staffId: string | null, day: string) => google.filter((g) => g.staffId === staffId
    && melbourneLocalParts(g.startsAt).date <= day && melbourneLocalParts(new Date(new Date(g.endsAt).getTime() - 1).toISOString()).date >= day);

  return (
    <>
      {said && <p className={`said ${said.ok ? "" : "bad"}`} data-testid="diary-said">{said.message}</p>}
      {laneList.length === 0 && <p className="empty">Nobody takes visits yet — tick an estimator under Settings → Estimator visits.</p>}
      <div className="lanes">
        {laneList.map((lane) => {
          const mine = (byLane.get(lane.staffId ?? "none") ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
          return (
            <div className="lane" key={lane.staffId ?? "none"} data-testid={`lane-${lane.staffId ?? "none"}`}>
              <div className="lanehead"><b>{lane.name}</b><span className="mono">{mine.filter((v) => v.status === "booked").length} booked</span></div>
              {days.map((day) => {
                const todays = mine.filter((v) => dayOf(v.starts_at) === day);
                const theirs = googleOn(lane.staffId, day);
                if (days.length > 1 && todays.length === 0 && theirs.length === 0) return null;
                return (
                  <div key={day}>
                    {days.length > 1 && <p className="laneday">{new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}</p>}
                    {todays.length === 0 && theirs.length === 0 && <p className="bhint" style={{ margin: "4px 0 8px" }}>Nothing booked.</p>}
                    {theirs.map((g, i) => (
                      <div className="visit google" key={`g-${g.startsAt}-${i}`} data-testid="google-entry" title={`From ${g.calendar}`}>
                        <div className="vhead">
                          <b className="mono">{g.allDay ? "All day" : `${time(g.startsAt)}–${time(g.endsAt)}`}</b>
                          <span className="cchip">Google</span>
                        </div>
                        <p className="vwho">{g.label}<span className="vkind"> · {g.calendar}</span></p>
                      </div>
                    ))}
                    {todays.map((v) => (
                      <div className={`visit ${v.status}`} key={v.id} data-testid={`visit-${v.id}`}>
                        <div className="vhead">
                          <b className="mono">{time(v.starts_at)}–{time(v.ends_at)}</b>
                          <span className={`cchip ${v.status === "no_show" || v.status === "rebook" ? "warn" : ""}`}>{STATUS_LABEL[v.status]}</span>
                        </div>
                        <p className="vwho">
                          {v.account_id ? <Link href={`/crm/customers/${v.account_id}`}>{v.customer_name || "Customer"}</Link> : (v.customer_name || "Customer")}
                          <span className="vkind"> · {VISIT_KINDS.find((k) => k.key === v.kind)?.label ?? v.kind}</span>
                        </p>
                        <p className="vmeta">{[v.address, v.customer_phone].filter(Boolean).join(" · ") || "No address on file"}</p>
                        {v.note && <p className="vmeta">{v.note}</p>}
                        {v.outcome_note && <p className="vmeta">Outcome: {v.outcome_note}</p>}
                        {v.status === "booked" && (
                          <div className="chips" style={{ marginTop: 6 }}>
                            <button className="chip" disabled={busy} onClick={() => setOutcomeFor({ id: v.id, status: "done" })}>Done</button>
                            <button className="chip" disabled={busy} onClick={() => setOutcomeFor({ id: v.id, status: "no_show" })}>No show</button>
                            <button className="chip" disabled={busy} onClick={() => run(() => visitOutcomeAction(v.id, "rebook"))}>Rebook</button>
                            <button className="chip" disabled={busy} onClick={() => setMoving(moving === v.id ? null : v.id)}>Move</button>
                            <button className="chip" disabled={busy} onClick={() => { if (window.confirm("Cancel this visit? The customer's calendar entry is pulled.")) run(() => visitOutcomeAction(v.id, "cancelled", "Cancelled by the office.")); }}>Cancel</button>
                          </div>
                        )}
                        {(v.status === "no_show" || v.status === "rebook") && (
                          <div className="chips" style={{ marginTop: 6 }}>
                            <button className="chip" disabled={busy} onClick={() => setMoving(moving === v.id ? null : v.id)}>Book again</button>
                          </div>
                        )}
                        {outcomeFor?.id === v.id && (
                          <div className="row" data-testid="outcome-form">
                            <input className="field" placeholder={outcomeFor.status === "done" ? "What came of it — measurements confirmed, scope changes…" : "Anything to note"} value={note} onChange={(e) => setNote(e.target.value)} />
                            <button className="go" disabled={busy} onClick={() => run(() => visitOutcomeAction(v.id, outcomeFor.status, note))}>
                              {busy ? "Saving…" : outcomeFor.status === "done" ? "Mark done" : "Record no show"}
                            </button>
                          </div>
                        )}
                        {moving === v.id && <MoveForm visit={v} lanes={lanes} busy={busy} onMove={(s, e, st) => run(() => moveVisitAction(v.id, s, e, st))} />}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MoveForm({ visit, lanes, busy, onMove }: { visit: VisitRow; lanes: Lane[]; busy: boolean; onMove: (s: string, e: string, staffId: string | null) => void }) {
  const p = melbourneLocalParts(visit.starts_at);
  const minutes = Math.round((new Date(visit.ends_at).getTime() - new Date(visit.starts_at).getTime()) / 60_000);
  const [date, setDate] = useState(p.date);
  const [time, setTime] = useState(p.time);
  const [staffId, setStaffId] = useState(visit.staff_id ?? "");
  return (
    <div className="row" data-testid="move-form">
      <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ minWidth: 150 }} />
      <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" style={{ minWidth: 110 }} />
      <select className="field" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Estimator" style={{ minWidth: 150 }}>
        <option value="">— unassigned —</option>
        {lanes.filter((l) => l.staffId).map((l) => <option key={l.staffId!} value={l.staffId!}>{l.name}</option>)}
      </select>
      <button className="go" disabled={busy} onClick={() => {
        const s = melbourneInstantFromLocal(date, time);
        onMove(s.toISOString(), new Date(s.getTime() + minutes * 60_000).toISOString(), staffId || null);
      }}>{busy ? "Moving…" : "Move it"}</button>
    </div>
  );
}
