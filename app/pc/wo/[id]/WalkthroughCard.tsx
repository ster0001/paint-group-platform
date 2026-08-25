"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bookWalkthrough, markClientUnavailable, setWalkthroughRequired, setWalkthroughStatus, staffSign, staffStartWalkthrough,
} from "../../actions";

export type WalkthroughRow = {
  id: string; kind: string; scheduledDate: string; status: string;
};

/**
 * §4b, the staff side: book the walkthroughs, and hold the Mode B gate.
 *
 * The final is required and defaults to the last day on site (the RPC reads
 * the booking; the date field here is an override). Remote sign-off stays
 * locked until "missed" or "can't attend" is pressed — both are deliberate,
 * logged staff acts, which is the whole point of the gate.
 *
 * Tom, 23 Aug: a real calendar to pick the date from; the estimated finish
 * read from the booking; and the office can run the walkthrough on OUR device
 * or record a manual sign-off from our side.
 */
export default function WalkthroughCard({
  workOrderId, walkthroughs, clientUnavailable, signedAt, startDate, endDate, stage, walkthroughRequired = true,
}: {
  workOrderId: string;
  walkthroughs: WalkthroughRow[];
  clientUnavailable: boolean;
  signedAt: string | null;
  /** The booking's span, from the work order (kept in step by trigger). */
  startDate: string | null;
  endDate: string | null;
  stage: string;
  /** False = "walkthrough not required" on the booking (Tom, 23 Aug). */
  walkthroughRequired?: boolean;
}) {
  const router = useRouter();
  const dateRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [signing, setSigning] = useState(false);
  const [signName, setSignName] = useState("");
  const [signNote, setSignNote] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const r = await fn();
      setMessage(r.message ?? (r.ok ? "Done." : "That didn't work."));
      if (r.ok) router.refresh();
    });

  const final = walkthroughs.find((w) => w.kind === "final" && w.status === "booked");
  const missed = walkthroughs.some((w) => w.kind === "final" && w.status === "missed");
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const daysBooked = startDate && endDate
    ? Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1)
    : null;

  // Opens the browser's own calendar on the date field (falls back to focus).
  function openCalendar() {
    const el = dateRef.current;
    if (!el) return;
    const withPicker = el as HTMLInputElement & { showPicker?: () => void };
    try { withPicker.showPicker ? withPicker.showPicker() : el.focus(); } catch { el.focus(); }
  }

  return (
    <div className="card" data-testid="walkthrough-card">
      <h3>Walkthrough <em>{signedAt ? "signed" : final ? fmt(final.scheduledDate) : "not booked"}</em></h3>

      {/* The finish the calendar says — the default for the final walkthrough. */}
      {endDate && (
        <p className="note" data-testid="estimated-finish" style={{ marginTop: 4 }}>
          Estimated finish <b>{fmt(endDate)}</b>
          {daysBooked ? ` · ${daysBooked} day${daysBooked === 1 ? "" : "s"} booked` : ""}
          {startDate ? ` from ${fmt(startDate)}` : ""}
        </p>
      )}

      {walkthroughs.length > 0 && (
        <div style={{ display: "grid", gap: 4, margin: "8px 0" }}>
          {walkthroughs.map((w) => (
            <div key={w.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}
              data-testid={`walkthrough-${w.id}`}>
              <span className={`pill ${w.status === "booked" ? "p-cy" : w.status === "missed" ? "p-clay" : ""}`}>
                {w.kind === "final" ? "Final" : "Pre"}
              </span>
              <span>{fmt(w.scheduledDate)}</span>
              <span style={{ color: "var(--muted)" }}>{w.status}</span>
              {w.status === "booked" && !signedAt && (
                <>
                  <button className="btn dim" disabled={pending} style={{ marginLeft: "auto", padding: "4px 8px" }}
                    onClick={() => run(() => setWalkthroughStatus({ walkthroughId: w.id, status: "missed" }))}
                    data-testid={`walkthrough-missed-${w.id}`}>
                    Missed
                  </button>
                  <button className="btn dim" disabled={pending} style={{ padding: "4px 8px" }}
                    onClick={() => run(() => setWalkthroughStatus({ walkthroughId: w.id, status: "cancelled" }))}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!signedAt && stage !== "closed" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, margin: "8px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={!walkthroughRequired} disabled={pending} data-testid="walkthrough-not-required"
            onChange={(e) => run(() => setWalkthroughRequired({ workOrderId, required: !e.target.checked }))} />
          Walkthrough not required — the job closes (invoice stage) once it&rsquo;s finished and checked
        </label>
      )}

      {!signedAt && !walkthroughRequired && (
        <p className="note" data-testid="no-walkthrough-note">
          No customer walkthrough on this booking. When the painter finishes (and any quality
          check passes) the job closes itself — report frozen, warranty started.
        </p>
      )}

      {!signedAt && walkthroughRequired && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <input ref={dateRef} type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ fontSize: 13 }} data-testid="walkthrough-date" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              style={{ fontSize: 13 }} data-testid="walkthrough-time"
              title="The time confirmed with the client — reminders hang off this later" />
            <button type="button" className="btn dim" onClick={openCalendar} data-testid="walkthrough-pick-date"
              title="Open the calendar">📅 Pick a date</button>
            <button className="btn" disabled={pending} data-testid="book-final"
              onClick={() => run(() => bookWalkthrough({ workOrderId, kind: "final", date: date || null, time: time || null, note: "" }))}>
              {final ? "Rebook final" : "Book final"}
            </button>
            <button className="btn dim" disabled={pending}
              onClick={() => run(() => bookWalkthrough({ workOrderId, kind: "pre", date: date || null, time: time || null, note: "" }))}>
              Book pre
            </button>
          </div>
          <p className="note" style={{ marginTop: 6 }}>
            Book this with the customer when you book the job in. Leave the date
            empty and the final lands on the last day on site. The painter can
            also start the walkthrough themselves, and move the finish date if
            they&rsquo;re early or late.
          </p>

          {/* Our side of the sign-off (Tom, 23 Aug): run it on our device with
              the customer, or record it when they've approved another way. */}
          {stage === "walkthrough" && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }} data-testid="staff-signoff">
              <p className="note">Sign-off from our side — when you&rsquo;re with the customer, or they&rsquo;ve approved by phone or on paper.</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn" disabled={pending} data-testid="staff-walkthrough"
                  onClick={() => startTransition(async () => {
                    setMessage(null);
                    const r = await staffStartWalkthrough({ workOrderId });
                    if (r.ok && r.url) window.open(`${r.url}?back=${encodeURIComponent(`/pc/wo/${workOrderId}`)}`, "_blank", "noopener");
                    setMessage(r.message ?? null);
                  })}>
                  Walk through on this device
                </button>
                <button className="btn dim" disabled={pending} data-testid="staff-sign-open"
                  onClick={() => setSigning((v) => !v)}>
                  {signing ? "Hide" : "Record sign-off manually"}
                </button>
              </div>
              {signing && (
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <input className="num" style={{ width: "100%" }} value={signName} placeholder="Customer's full name"
                    onChange={(e) => setSignName(e.target.value)} data-testid="staff-sign-name" />
                  <textarea className="edit" rows={2} value={signNote} data-testid="staff-sign-note"
                    placeholder="How they approved — e.g. by phone 3:10pm, happy with everything"
                    onChange={(e) => setSignNote(e.target.value)} />
                  <div className="row">
                    <button className="btn primary" disabled={pending || !signName.trim()} data-testid="staff-sign"
                      onClick={() => run(() => staffSign({ workOrderId, name: signName.trim(), note: signNote.trim() }))}>
                      {pending ? "Signing…" : "Sign off and close the job"}
                    </button>
                  </div>
                  <p className="note" style={{ margin: 0 }}>
                    Any area the customer hasn&rsquo;t answered is approved on their behalf. Recorded as signed by staff.
                  </p>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            {clientUnavailable || missed ? (
              <p className="note" data-testid="modeb-open">
                Remote sign-off is <b>open</b> — {missed ? "the walkthrough was missed" : "the customer can't attend"}.
                Their own link can sign now.
              </p>
            ) : (
              <>
                <p className="note">
                  Sign-off happens on the painter&rsquo;s phone at the walkthrough. Only open
                  the remote path if the customer genuinely can&rsquo;t be there.
                </p>
                <button className="btn dim" disabled={pending} data-testid="mark-unavailable"
                  onClick={() => run(() => markClientUnavailable({ workOrderId }))}>
                  Customer can&rsquo;t attend — open remote sign-off
                </button>
              </>
            )}
          </div>
        </>
      )}

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid="walkthrough-msg">{message}</p>}
    </div>
  );
}
