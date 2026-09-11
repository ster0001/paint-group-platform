"use client";

import { useState } from "react";
import { handoffSteps } from "@/lib/wizard/finish-line";

/**
 * SCREEN 11 — "Thanks, [name] has it."
 *
 * The plan's hand-off screen (§3, §9.6), and until now the only thing that
 * happened when a customer sent their job to an estimator was a toast at the
 * bottom of the editor. They had just handed over the biggest decision in the
 * whole flow and got a sentence that disappeared after three seconds.
 *
 * Four things, because these are the four questions somebody actually has at
 * that moment: who has it, what happens next, can I still get a visit, and
 * where has my estimate gone.
 */
export default function Sent({
  estimateId, coordinator, companyPhone, email, roomsTotal, spots, photos, turnaround, visitSlots, status = null,
  whoHasIt = null,
}: {
  estimateId: string;
  coordinator: string;
  companyPhone: string | null;
  /** Where the link went — omitted when we never got one. */
  email: string | null;
  roomsTotal: number;
  spots: number;
  photos: number;
  turnaround: string;
  visitSlots: string[];
  /** C6 — where the request actually is, derived from the row. */
  status?: { headline: string; detail: string } | null;
  /** C7 — the estimator and their patch, in the customer's own geography. */
  whoHasIt?: string | null;
}) {
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = handoffSteps({ roomsTotal, spots, photos, turnaround });

  async function book(pick: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "book_visit", slot: pick, view: "customer" }),
      });
      if (res.ok) setBooked(pick);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wz-wrap wz-sent" data-testid="sent">
      <p className="wz-kick">Sent to your estimator</p>
      <h1>Thanks — {coordinator} has it</h1>
      <p className="wz-sub">
        Your answers, photos and range are with your estimator. Here&rsquo;s what happens next.
      </p>

      {/* C7 — the prototype introduces a person here, and the introduction is
          only worth making if it is true: the name is from `profiles`, the
          patch is the customer's own suburb, and nothing is said when we
          cannot name anybody. */}
      {whoHasIt && <p className="wz-sub wz-who" data-testid="sent-who">{whoHasIt}</p>}

      {/* C6 — where it ACTUALLY is, derived from the confirmation row. A
          customer who comes back to this link a day later should find out what
          happened without ringing to ask, and a fixed price should say its
          number here rather than only in an email they may have lost. */}
      {status && (
        <div className="wz-sent-status" data-testid="sent-status">
          <b>{status.headline}</b>
          <span>{status.detail}</span>
        </div>
      )}

      <ol className="wz-steps-list" data-testid="sent-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="wz-step-n" aria-hidden="true">{i + 1}</span>
            <span>
              <b>{s.title}</b>
              <span>{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* A visit stays available even though we have just said most jobs like
          this one don't need one — §1's rule that the two doors have no
          hierarchy holds right to the end. */}
      {visitSlots.length > 0 && (
        <div className="wz-sent-slots" data-testid="sent-slots">
          <p className="wz-qhead">
            {booked ? "Your visit" : "Prefer a visit anyway?"}
            {!booked && <span className="wz-opt"> — pick a time</span>}
          </p>
          {booked ? (
            <p className="wz-kept" data-testid="sent-booked">
              Booked for <b>{booked}</b>. We&rsquo;ll confirm it by email, and we arrive with your answers already on the tablet.
            </p>
          ) : (
            <div className="wz-chips">
              {visitSlots.map((s) => (
                <button
                  key={s} type="button" className={`wz-tile ${slot === s ? "on" : ""}`}
                  data-testid="sent-slot" disabled={busy}
                  onClick={() => { setSlot(s); void book(s); }}
                >{s}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="wz-kept" data-testid="sent-saved">
        <b>Your estimate is saved.</b>{" "}
        {email
          ? <>We&rsquo;ve sent a link to <b>{email}</b>. Use it to see the price, your photos and where things are up to — no password needed.</>
          : <>Open it any time from the link in your email, or <a className="wz-linkish" href={`/estimate/scope?id=${estimateId}`}>pick it up here</a>.</>}
      </div>

      {companyPhone && (
        <p className="wz-reveal-call">
          Something urgent? <a href={`tel:${companyPhone.replace(/[^0-9+]/g, "")}`}>Call {companyPhone}</a>
        </p>
      )}
    </div>
  );
}
