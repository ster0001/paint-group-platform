"use client";

import { useEffect } from "react";
import { initialsOf } from "@/lib/wizard/estimator";
import type { WizardBrand } from "@/lib/wizard/brand";

/**
 * Wizard mobile v5, session 5 (brief §5) — the CONTACT sheet behind the
 * pill on every phone screen (R6). The prototype's menu: the estimator line,
 * the one teal door, then Call · Send a message · Save and come back later.
 *
 * Every door hands over to a mechanism the platform already has — this
 * sheet decides nothing and books nothing itself:
 *   · Book a visit / Book a call → before the range, the visit module's own
 *     pre-range path (a REQUEST for a time, R3: never a slot before the
 *     range) through the talk sheet; on the gate, the booking page
 *     (/estimate/visit — the zone's pre-set days, the hold and the texted
 *     code) on Paint Group, the call request on Paint Home (phone-close).
 *   · Call → tel:
 *   · Send a message → the talk sheet's message mode
 *   · Save and come back later → Save & book (the link back by email)
 * ⚑ The brief's slot booking from step 3 on name + mobile alone, confirmed
 * by a text rather than a code, needs three rulings first (ledger M5 · S5).
 */
export default function MobileContact({ open, onClose, brand, estimatorName, suburb, phone, onBook, onMessage, onSave }: {
  open: boolean;
  onClose: () => void;
  brand: WizardBrand;
  estimatorName: string | null;
  suburb: string | null;
  phone: string | null;
  onBook: () => void;
  onMessage: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const name = estimatorName?.trim() || null;
  const first = name?.split(/\s+/)[0] ?? null;
  const painthome = brand === "painthome";
  const where = suburb?.trim() ? `Your estimator for ${suburb.trim()}` : "Your estimator";
  const go = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <div className="wz-sheetback wzm-sheetback" role="dialog" aria-modal="true" aria-label="Contact" data-testid="wzm-contact-sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wz-sheet wzm-sheet wzm-contact">
        <button type="button" className="wz-sheet-x" aria-label="Close" onClick={onClose} data-testid="wzm-contact-x">×</button>
        <div className="wzm-grab" aria-hidden="true" />
        <div className="wzm-srow wzm-srow--who" data-testid="wzm-contact-who">
          <span className="wzm-av" aria-hidden="true">{name ? initialsOf(name) : painthome ? "PH" : "PG"}</span>
          <div><b>{name ?? "Your estimator"}</b><small>{name ? where : "One of our estimators looks after your area"}</small></div>
        </div>
        {/* Brief §5 (27 Oct, approved): Book a visit on both shopfronts — it supersedes the Paint Home phone-close door set for this one door. */}
        <button type="button" className="wzm-cta wzm-cta--teal wzm-contact-book" onClick={go(onBook)} data-testid="wzm-contact-book">
          Book a visit
          <small>{first ?? "Your estimator"} comes to you. About 40 minutes, no charge.</small>
        </button>
        {phone && (
          <a className="wzm-srow" href={`tel:${phone.replace(/\s+/g, "")}`} data-testid="wzm-contact-call">Call {phone}<small>Mon–Fri, 8–6</small></a>
        )}
        <button type="button" className="wzm-srow" onClick={go(onMessage)} data-testid="wzm-contact-message">Send a message<small>We reply the same day</small></button>
        <button type="button" className="wzm-srow" onClick={go(onSave)} data-testid="wzm-contact-save">Save and come back later<small>We email you the link</small></button>
      </div>
    </div>
  );
}
