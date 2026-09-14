"use client";
import { useState } from "react";
import EstimatorStrip from "@/app/wizard/EstimatorStrip";
import ReachStrip from "@/app/estimate/scope/ReachStrip";
import type { ContactRequest } from "@/app/estimate/scope/ContactCard";

/**
 * /estimate/book — Tom, 14 Sep (tighten batch, item 3): "Book a time" leaves
 * the editor for its own page. The slot picker and the call-back form are the
 * editor's old reach strip, posting the same `book_visit` / `request_contact`
 * actions; Tom finishes the page's shape later.
 */
export default function Book({ estimateId, estimator, companyPhone, phoneHours, customerPhone, visitSlots, suburb }: {
  estimateId: string;
  estimator: { name: string | null; phone: string | null; covers: boolean } | null;
  companyPhone: string | null;
  phoneHours: string | null;
  customerPhone: string | null;
  visitSlots: string[];
  suburb: string | null;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, said: string) {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, view: "customer" }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setError(j.error ?? "That didn't go through — try again in a moment."); return; }
      setDone(said);
    } catch { setError("That didn't go through — check your connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <main className="wz-wrap sc-book" data-testid="book-page">
      <p className="wz-kick">Book a time</p>
      <h1>Pick how you&rsquo;d like to finalise your price</h1>
      <EstimatorStrip estimator={estimator} suburb={suburb} companyPhone={companyPhone} bookHref="#reach" />
      {done ? (
        <div className="sc-done-banner sent" data-testid="book-done" role="status">
          <b>{done}</b>
          <span>We&rsquo;re available Monday to Friday. <a className="wz-linkish" href={`/estimate/scope?id=${estimateId}`}>Back to your estimate</a></span>
        </div>
      ) : (
        <ReachStrip
          estimator={estimator} companyPhone={companyPhone} phoneHours={phoneHours} defaultPhone={customerPhone}
          visitSlots={visitSlots} busy={busy}
          onBookSlot={(slot) => void post({ action: "book_visit", slot }, `Booked — ${slot}. A calendar invite is on its way.`)}
          onContact={(req: ContactRequest) => void post({ action: "request_contact", ...req }, req.how === "visit" ? "Thanks — we'll ring you to lock in a visit time that suits." : "Thanks — we'll call you back to finalise your price.")}
        />
      )}
      {error && <p className="wz-err" data-testid="book-error">{error}</p>}
      <p className="wz-chint"><a className="wz-linkish" href={`/estimate/scope?id=${estimateId}`} data-testid="book-back">Back to your estimate</a></p>
    </main>
  );
}
