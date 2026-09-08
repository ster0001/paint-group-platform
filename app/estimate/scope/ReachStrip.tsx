"use client";

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

function Icon({ name }: { name: "visit" | "call" | "callback" }) {
  return (
    <span className="reach-ic" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {name === "visit" && <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>}
        {name === "call" && <path d="M21 16.9v2.6a1.7 1.7 0 0 1-1.9 1.7 17 17 0 0 1-7.4-2.6 16.6 16.6 0 0 1-5.1-5.1A17 17 0 0 1 4 6.1 1.7 1.7 0 0 1 5.7 4.2h2.6a1.7 1.7 0 0 1 1.7 1.5c.1.9.3 1.7.6 2.5a1.7 1.7 0 0 1-.4 1.8l-1.1 1.1a13.6 13.6 0 0 0 5.1 5.1l1.1-1.1a1.7 1.7 0 0 1 1.8-.4c.8.3 1.6.5 2.5.6a1.7 1.7 0 0 1 1.4 1.6Z" />}
        {name === "callback" && <><path d="M3 12a9 9 0 1 1 3 6.7" /><path d="M3 20v-5h5" /></>}
      </svg>
    </span>
  );
}

export default function ReachStrip({ prefix = "sc", companyPhone, phoneHours, visitSlots, defaultPhone = null, busy = false, onBookSlot, onContact }: {
  prefix?: "sc" | "sd";
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
  const [when, setWhen] = useState("");
  const tel = companyPhone ? `tel:${companyPhone.replace(/\s+/g, "")}` : null;
  const phoneOk = phone.replace(/[^0-9+]/g, "").length >= 8;
  const p = prefix;
  const toggle = (m: Mode) => setMode((cur) => (cur === m ? "idle" : m));

  return (
    <div className={`${p}-reach`} data-testid="reach-strip">
      <div className={`${p}-reach-row`}>
        <span className={`${p}-reach-lead`}>Book in your estimator</span>
        <button type="button" className={`${p}-contact-opt reach-b${mode === "visit" ? " on" : ""}`} onClick={() => toggle("visit")} data-testid="reach-visit">
          <Icon name="visit" />Book a site visit
        </button>
        {tel && (
          <a className={`${p}-contact-opt reach-b`} href={tel} data-testid="reach-call">
            <Icon name="call" />Call us <b>{companyPhone}</b>
          </a>
        )}
        <button type="button" className={`${p}-contact-opt reach-b${mode === "callback" ? " on" : ""}`} onClick={() => toggle("callback")} data-testid="reach-callback">
          <Icon name="callback" />Request a call back
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
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your mobile number" inputMode="tel" aria-label="Your mobile number" data-testid="reach-phone" required />
          {defaultPhone && phone.trim() === defaultPhone.trim() && (
            <p className={`${p}-contact-t`} style={{ fontWeight: 400, fontSize: 12 }}>That&rsquo;s the number you gave us — change it if another one suits.</p>
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
