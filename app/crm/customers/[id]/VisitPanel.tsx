"use client";

import { useState, useTransition } from "react";
import { VISIT_KINDS, STATUS_LABEL, type VisitKind, type VisitRow } from "@/lib/visits/types";
import { bookVisitAction, visitOutcomeAction } from "../../diary/actions";
import { melbourneInstantFromLocal } from "../../diary/time";

/**
 * Booking a visit from the record (P6). Estimator, date, time, kind, a note.
 * The database refuses a double-booking; the customer gets the invite; the
 * estimator's calendar updates — none of it is this form's job.
 */
export default function VisitPanel({ accountId, propertyId, estimateId, staff, visits, today }: {
  accountId: string;
  propertyId: string | null;
  estimateId: string | null;
  staff: Array<{ id: string; name: string; takesVisits: boolean; visitMinutes: number }>;
  visits: VisitRow[];
  /** Melbourne date, for the date field's default. */
  today: string;
}) {
  const takers = staff.filter((s) => s.takesVisits);
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState(takers[0]?.id ?? staff[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [kind, setKind] = useState<VisitKind>("quote");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();

  const minutes = staff.find((s) => s.id === staffId)?.visitMinutes ?? VISIT_KINDS.find((k) => k.key === kind)?.minutes ?? 60;
  const upcoming = visits.filter((v) => v.status === "booked" || v.status === "rebook" || v.status === "no_show");
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="panel" data-testid="visit-panel">
      <div className="row" style={{ marginTop: 0, alignItems: "center" }}>
        <p className="plabel" style={{ margin: 0, flex: 1 }}>Visits</p>
        <button className="chip" onClick={() => setOpen((o) => !o)} data-testid="book-visit">{open ? "Never mind" : "+ Book a visit"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 10 }} data-testid="visit-form">
          <div className="row" style={{ marginTop: 0 }}>
            <select className="field" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Estimator" style={{ minWidth: 150 }} data-testid="visit-staff">
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.takesVisits ? "" : " (doesn't take visits)"}</option>)}
            </select>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ minWidth: 150 }} data-testid="visit-date" />
            <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" style={{ minWidth: 110 }} data-testid="visit-time" />
            <select className="field" value={kind} onChange={(e) => setKind(e.target.value as VisitKind)} aria-label="Kind" style={{ minWidth: 150 }}>
              {VISIT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
          <div className="row">
            <input className="field" placeholder="Anything the estimator should know" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="go" disabled={busy || !date || !time} data-testid="visit-save" onClick={() => start(async () => {
              const s = melbourneInstantFromLocal(date, time);
              const r = await bookVisitAction({
                accountId, propertyId, estimateId, staffId: staffId || null, kind, note: note || null,
                startsAt: s.toISOString(), endsAt: new Date(s.getTime() + minutes * 60_000).toISOString(),
              });
              setSaid(r);
              if (r.ok) { setOpen(false); setNote(""); }
            })}>{busy ? "Booking…" : `Book ${minutes} min`}</button>
          </div>
        </div>
      )}
      {upcoming.length === 0 && !open && <p className="bhint" style={{ margin: "6px 0 0" }}>No visit booked.</p>}
      <div className="visitlist">
        {upcoming.map((v) => (
          <div className={`visit ${v.status}`} key={v.id} data-testid={`record-visit-${v.id}`}>
            <div className="vhead"><b>{fmt(v.starts_at)}</b><span className={`cchip ${v.status !== "booked" ? "warn" : ""}`}>{STATUS_LABEL[v.status]}</span></div>
            <p className="vmeta">{[VISIT_KINDS.find((k) => k.key === v.kind)?.label, staff.find((s) => s.id === v.staff_id)?.name ?? "Unassigned", v.note].filter(Boolean).join(" · ")}</p>
            {v.status === "booked" && (
              <div className="chips" style={{ marginTop: 6 }}>
                <button className="chip" disabled={busy} onClick={() => start(async () => setSaid(await visitOutcomeAction(v.id, "done")))}>Done</button>
                <button className="chip" disabled={busy} onClick={() => start(async () => setSaid(await visitOutcomeAction(v.id, "no_show")))}>No show</button>
                <button className="chip" disabled={busy} onClick={() => { if (window.confirm("Cancel this visit?")) start(async () => setSaid(await visitOutcomeAction(v.id, "cancelled", "Cancelled by the office."))); }}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {said && <p className={`said ${said.ok ? "" : "bad"}`} data-testid="visit-said">{said.message}</p>}
    </div>
  );
}
