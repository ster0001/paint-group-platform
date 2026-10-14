"use client";

import { useState, useTransition } from "react";
import { answerPayChangeAction } from "./variationActions";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perHour = (c: number) => money(c).replace(/\.00$/, "") + "/h";

export type PayChangeView = { fromRateCents: number; toRateCents: number; fromCents: number; toCents: number };

/**
 * Tom, 13 Oct 2026: the office changed the hourly rate on a job this
 * contractor already has (20270254). Never a variation — the customer is not
 * part of it — so it is its own card: the rate and the job's pay, before and
 * after, Accept in big letters, Decline with a note.
 */
export default function PayChangeCard({ workOrderId, change }: { workOrderId: string; change: PayChangeView }) {
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function answer(accept: boolean) {
    setMessage(null);
    start(async () => {
      const r = await answerPayChangeAction({ workOrderId, accept, note: accept ? "" : note });
      if (r.ok) setDone(accept ? "accepted" : "declined");
      else setMessage(r.message);
    });
  }

  return (
    <div className="card" style={{ marginTop: 12 }} data-testid="pay-change">
      <div className="var-approved">
        <p className="var-approved-head">Change to your rate</p>
        <p className="var-approved-figures">
          <b data-testid="pay-change-rate">{perHour(change.fromRateCents)} → {perHour(change.toRateCents)}</b>
          <span data-testid="pay-change-pay">Pay for this job {money(change.fromCents)} → {money(change.toCents)}</span>
        </p>
        {done === "accepted" ? (
          <p className="note" data-testid="pay-change-done">Accepted — your pay for this job is now {money(change.toCents)}.</p>
        ) : done === "declined" ? (
          <p className="note" data-testid="pay-change-done">You declined the new rate — it is back with the office, and your pay stays {money(change.fromCents)}.</p>
        ) : (
          <>
            <button type="button" className="var-send var-accept-big" disabled={pending}
              onClick={() => answer(true)} data-testid="pay-change-accept">
              Accept {perHour(change.toRateCents)} — {money(change.toCents)}
            </button>
            {!declining ? (
              <button type="button" className="var-decline-small" disabled={pending}
                onClick={() => { setDeclining(true); setNote(""); setMessage(null); }} data-testid="pay-change-decline">
                Decline
              </button>
            ) : (
              <div className="var-decline-box" data-testid="pay-change-decline-box">
                <label htmlFor="pay-change-note">Please advise us of any further changes</label>
                <textarea id="pay-change-note" rows={3} maxLength={1000} value={note}
                  placeholder="What rate would work for you on this job?"
                  onChange={(e) => setNote(e.target.value)} data-testid="pay-change-note" />
                <div className="var-decline-acts">
                  <button type="button" className="var-send" disabled={pending} onClick={() => answer(false)} data-testid="pay-change-decline-send">Send to the office</button>
                  <button type="button" className="var-decline-small" disabled={pending} onClick={() => setDeclining(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
        {message && <p className="tick-msg" role="status" data-testid="pay-change-message">{message}</p>}
      </div>
    </div>
  );
}
