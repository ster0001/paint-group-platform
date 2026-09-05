"use client";

import { useState } from "react";

/**
 * "Finalise my price" (Tom, 5 Sep 2026) — replaces the self-serve visit
 * slot strip. The customer picks how they want to settle the quote:
 *   · call us now (a tel: link — the office number from Settings),
 *   · ask us to call them back (a window + their mobile), or
 *   · ask for a site visit and tell us when suits, so we schedule around them.
 * The page owns the write (one route action); this card only collects.
 */
export type ContactHow = "callback" | "visit";
export type ContactWindow = "am" | "pm" | "any";
export type ContactRequest = { how: ContactHow; window: ContactWindow; phone: string; when: string };

export default function ContactCard({ companyPhone, onSubmit, busy = false, prefix = "sc" }: {
  companyPhone: string | null;
  onSubmit: (req: ContactRequest) => void;
  busy?: boolean;
  /** "sc" on the rooms editor, "sd" on the sides editor — the class prefix each already styles. */
  prefix?: "sc" | "sd";
}) {
  const [how, setHow] = useState<ContactHow | null>(null);
  const [win, setWin] = useState<ContactWindow>("any");
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState("");
  const tel = companyPhone ? `tel:${companyPhone.replace(/\s+/g, "")}` : null;
  const phoneOk = phone.replace(/[^0-9+]/g, "").length >= 8;

  return (
    <div className={`${prefix}-contact`} data-testid="contact-card">
      <p className={`${prefix}-contact-t`}>How would you like to finalise your price?</p>
      <div className={`${prefix}-contact-opts`}>
        {tel && <a className={`${prefix}-contact-opt`} href={tel} data-testid="contact-call">Call us now <b>{companyPhone}</b></a>}
        <button type="button" className={`${prefix}-contact-opt${how === "callback" ? " on" : ""}`} onClick={() => setHow("callback")} data-testid="contact-callback">Ask us to call you back</button>
        <button type="button" className={`${prefix}-contact-opt${how === "visit" ? " on" : ""}`} onClick={() => setHow("visit")} data-testid="contact-visit">Request a site visit</button>
      </div>
      {how && (
        <form
          className={`${prefix}-contact-form`}
          data-testid="contact-form"
          onSubmit={(e) => { e.preventDefault(); if (!phoneOk || busy) return; onSubmit({ how, window: win, phone: phone.trim(), when: when.trim() }); }}
        >
          <div className={`${prefix}-contact-row`}>
            {(["am", "pm", "any"] as const).map((w) => (
              <button key={w} type="button" className={`${prefix}-contact-chip${win === w ? " on" : ""}`} onClick={() => setWin(w)} aria-pressed={win === w}>
                {w === "am" ? "Mornings" : w === "pm" ? "Afternoons" : "Any time"}
              </button>
            ))}
          </div>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your mobile number" inputMode="tel" aria-label="Your mobile number" data-testid="contact-phone" required />
          {how === "visit" && (
            <input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={300} placeholder="When suits you for a visit? e.g. weekday mornings, not Wednesdays" aria-label="When suits you" data-testid="contact-when" />
          )}
          <button type="submit" className={`${prefix}-contact-go`} disabled={!phoneOk || busy} data-testid="contact-send">
            {how === "visit" ? "Request the visit" : "Request the call back"}
          </button>
        </form>
      )}
    </div>
  );
}
