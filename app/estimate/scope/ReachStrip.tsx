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
 *   · Call us — the office number from Settings;
 *   · Request a call back — a mobile and a window.
 * The page owns every write (book_visit / request_contact); this only collects.
 */
type Mode = "idle" | "visit" | "callback";

export default function ReachStrip({ prefix = "sc", companyPhone, visitSlots, busy = false, onBookSlot, onContact }: {
  prefix?: "sc" | "sd";
  companyPhone: string | null;
  visitSlots: string[];
  busy?: boolean;
  onBookSlot: (slot: string) => void;
  onContact: (req: ContactRequest) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [slot, setSlot] = useState<string | null>(null);
  const [win, setWin] = useState<ContactWindow>("any");
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState("");
  const tel = companyPhone ? `tel:${companyPhone.replace(/\s+/g, "")}` : null;
  const phoneOk = phone.replace(/[^0-9+]/g, "").length >= 8;
  const p = prefix;
  const toggle = (m: Mode) => setMode((cur) => (cur === m ? "idle" : m));

  return (
    <div className={`${p}-reach`} data-testid="reach-strip">
      <div className={`${p}-reach-row`}>
        <span className={`${p}-reach-lead`}>Rather talk to a person? Any time:</span>
        <button type="button" className={`${p}-contact-opt${mode === "visit" ? " on" : ""}`} onClick={() => toggle("visit")} data-testid="reach-visit">Book a site visit</button>
        {tel && <a className={`${p}-contact-opt`} href={tel} data-testid="reach-call">Call us <b>{companyPhone}</b></a>}
        <button type="button" className={`${p}-contact-opt${mode === "callback" ? " on" : ""}`} onClick={() => toggle("callback")} data-testid="reach-callback">Request a call back</button>
      </div>

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
