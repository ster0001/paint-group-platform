"use client";

import EstimatorStrip from "@/app/wizard/EstimatorStrip";

import { useState } from "react";
import type { ContactRequest, ContactWindow } from "./ContactCard";

/**
 * Tom, 8 Sep 2026 (second pass): the three ways to reach a person live at
 * the bottom of the BUILDER, not on the question pages — "we still need to
 * prompt them to tighten their estimate, but as some customers will get
 * bored, still allow them to speak with us at any time." So this strip sits
 * under the Finalise button on every visit, whatever is confirmed:
 *   · Book a site visit — the real windows on offer (the page books one),
 *     or, when none are open online, a request with when suits;
 *   · Call us — the office number from Settings, with the hours it answers;
 *   · Request a call back — their mobile, already filled in, and a window.
 * The page owns every write (book_visit / request_contact); this only collects.
 *
 * Tom, 8 Sep 2026 (fourth pass): "reframe this to 'book in your estimator'
 * and make the icons stand out more" — the strip now leads with the offer
 * rather than with an apology for the questions, and each action carries a
 * filled icon tile instead of a bare text chip.
 */
type Mode = "idle" | "visit" | "callback";


export default function ReachStrip({
  estimator = null, prefix = "sc", companyPhone, phoneHours, visitSlots, defaultPhone = null, busy = false, onBookSlot, onContact }: {
  prefix?: "sc" | "sd";
  /** C11 — the resolved estimator for the strip header, or null. */
  estimator?: { name: string | null; phone: string | null; covers: boolean } | null;
  companyPhone: string | null;
  /** When the office answers — Settings → Company details owns the wording. */
  phoneHours?: string | null;
  visitSlots: string[];
  /** The mobile the customer already gave us, pre-filled and still editable. */
  defaultPhone?: string | null;
  busy?: boolean;
  onBookSlot: (slot: string) => void;
  onContact: (req: ContactRequest) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [slot, setSlot] = useState<string | null>(null);
  const [win, setWin] = useState<ContactWindow>("any");
  // Tom, 8 Sep: "copy the number across that they have previously provided…
  // they can edit the number if required before submitting the request."
  const [phone, setPhone] = useState(defaultPhone?.trim() ?? "");
  /**
   * Tom, 9 Sep: *"remove the box to take a mobile number — we already take
   * their details at the start of the estimate; we could have their number
   * prewritten with a button to say change the number instead."*
   *
   * An input pre-filled with what they already told us still reads as a form
   * to fill in. Showing the number as a fact with a way to correct it is one
   * less thing between them and the call they asked for. Someone we have NO
   * number for still gets the box — that is the one case where it is a real
   * question rather than a repeated one.
   */
  const [editingPhone, setEditingPhone] = useState(!defaultPhone?.trim());
  const [when, setWhen] = useState("");
  const tel = companyPhone ? `tel:${companyPhone.replace(/\s+/g, "")}` : null;
  const phoneOk = phone.replace(/[^0-9+]/g, "").length >= 8;
  const p = prefix;
  const toggle = (m: Mode) => setMode((cur) => (cur === m ? "idle" : m));

  return (
    <div className={`${p}-reach`} data-testid="reach-strip" id="reach">
      {/*
        C11 (v2.4): no "Book in your estimator" heading and no icon-tile row —
        Tom, 10 Sep: booking a visit or calling can't be three little tiles
        under a heading. The estimator is named and present; the three ways
        to reach them are plain buttons under the name.
      */}
      <EstimatorStrip estimator={estimator} companyPhone={companyPhone} onBook={() => toggle("visit")} compact />
      <div className={`${p}-reach-row`}>
        <button type="button" className={`${p}-contact-opt${mode === "visit" ? " on" : ""}`} onClick={() => toggle("visit")} data-testid="reach-visit">
          Book a site visit
        </button>
        {tel && (
          <a className={`${p}-contact-opt`} href={tel} data-testid="reach-call">
            Call us <b>{companyPhone}</b>
          </a>
        )}
        <button type="button" className={`${p}-contact-opt${mode === "callback" ? " on" : ""}`} onClick={() => toggle("callback")} data-testid="reach-callback">
          Request a call back
        </button>
      </div>
      {/* Tom, 8 Sep: the hours have to sit with the button, not in a footer. */}
      {tel && phoneHours && <p className={`${p}-reach-hours`} data-testid="reach-hours">Our lines are open {phoneHours}.</p>}

      {mode === "visit" && visitSlots.length > 0 && (
        <div className={`${p}-contact-form`} data-testid="reach-slots">
          <div className={`${p}-contact-row`}>
            {visitSlots.map((s) => (
              <button key={s} type="button" className={`${p}-contact-chip${slot === s ? " on" : ""}`} onClick={() => setSlot(s)} aria-pressed={slot === s} data-testid="reach-slot">{s}</button>
            ))}
          </div>
          <button type="button" className={`${p}-contact-go`} disabled={!slot || busy} onClick={() => { if (slot) { onBookSlot(slot); setMode("idle"); } }} data-testid="reach-book">
            Book it
          </button>
        </div>
      )}

      {(mode === "callback" || (mode === "visit" && visitSlots.length === 0)) && (
        <form className={`${p}-contact-form`} data-testid="reach-form"
          onSubmit={(e) => { e.preventDefault(); if (!phoneOk || busy) return; onContact({ how: mode === "visit" ? "visit" : "callback", window: win, phone: phone.trim(), when: when.trim() }); setMode("idle"); }}>
          {mode === "visit" && <p className={`${p}-contact-t`} style={{ fontWeight: 500, fontSize: 13 }}>No open times online right now — tell us when suits and a person books it with you.</p>}
          <div className={`${p}-contact-row`}>
            {(["am", "pm", "any"] as const).map((w) => (
              <button key={w} type="button" className={`${p}-contact-chip${win === w ? " on" : ""}`} onClick={() => setWin(w)} aria-pressed={win === w}>
                {w === "am" ? "Mornings" : w === "pm" ? "Afternoons" : "Any time"}
              </button>
            ))}
          </div>
          {editingPhone ? (
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your mobile number" inputMode="tel" aria-label="Your mobile number" data-testid="reach-phone" required autoFocus={Boolean(defaultPhone)} />
          ) : (
            <p className={`${p}-contact-t`} data-testid="reach-phone-known" style={{ fontWeight: 400, fontSize: 13 }}>
              We&rsquo;ll ring <b>{phone}</b>.{" "}
              <button type="button" className="wz-linkish" data-testid="reach-phone-change"
                onClick={() => setEditingPhone(true)}>Use a different number</button>
            </p>
          )}
          {mode === "visit" && (
            <input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={300} placeholder="When suits you for a visit?" aria-label="When suits you" />
          )}
          <button type="submit" className={`${p}-contact-go`} disabled={!phoneOk || busy} data-testid="reach-send">
            {mode === "visit" ? "Request the visit" : "Request the call back"}
          </button>
        </form>
      )}
    </div>
  );
}
