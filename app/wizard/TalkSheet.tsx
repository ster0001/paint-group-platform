"use client";

import { useEffect, useState } from "react";

/**
 * "Would you rather talk it through?" (visit booking addendum A, R3/R4, R26 —
 * mockup 4's `details`, `msg` and `sent` screens). A sheet with two modes:
 *
 *   visit    — before the range: full name, address, email, mobile, an optional
 *              note → a REQUEST for staff to follow up. Never books a slot.
 *   message  — details first when we do not hold them, then the message box →
 *              posted into the customer's chat and emailed (R26, R35).
 *   call     — Speak with us (R25): the details, then a CALL request; the
 *              server refuses a job outside the phone range.
 *
 * Wording is the mockup's. Nothing is decided here; the routes do.
 */
export type TalkMode = "visit" | "message" | "call" | "details";

export default function TalkSheet({ open, mode, onClose, estimateId, prefill, hasContact = false, address = "", onDone }: {
  open: boolean;
  mode: TalkMode;
  onClose: () => void;
  /** After the range: the estimate; before it: null (the server finds the draft). */
  estimateId: string | null;
  prefill?: { name?: string; email?: string; mobile?: string };
  /** After the range, once we hold name + email + mobile: straight to the message box. */
  hasContact?: boolean;
  /** The property address when the estimate already has one (then it is not asked for). */
  address?: string;
  /** S6 (R7): "details" mode — the details are saved to the estimate and this is called, so the caller can carry on (Tighten my price). */
  onDone?: (c: { name: string; email: string; mobile: string }) => void;
}) {
  const [det, setDet] = useState({ name: prefill?.name ?? "", address, email: prefill?.email ?? "", mobile: prefill?.mobile ?? "", note: "" });
  // The sheet is mounted fresh each time it opens (the parent renders it only
  // while open), so its state starts here and no effect has to reset it.
  const [stage, setStage] = useState<"details" | "message" | "sent">(mode === "message" && hasContact ? "message" : "details");
  const [msg, setMsg] = useState("");
  const [clientId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const needAddress = !address;
  const validDet = det.name.trim().length >= 2 && /.+@.+\..+/.test(det.email) && det.mobile.replace(/\D/g, "").length >= 10 && (!needAddress || det.address.trim());
  const contact = { name: det.name.trim(), email: det.email.trim(), mobile: det.mobile.trim(), ...(needAddress ? { street: det.address.trim() } : {}) };

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true); setErr("");
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(estimateId ? { estimateId } : {}), ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "That didn't go through — please try again."); return false; }
      return true;
    } catch { setErr("That didn't go through — check your connection and try again."); return false; }
    finally { setBusy(false); }
  }

  async function afterDetails() {
    if (!validDet) { setErr(needAddress ? "Please fill in your name, address, email and mobile number." : "Please fill in your name, email and mobile number."); return; }
    if (mode === "visit" || mode === "call") {
      if (await post("/api/visits/request", { kind: mode, ...contact, note: det.note.trim() || undefined })) setStage("sent");
      return;
    }
    if (mode === "details") {
      if (await post("/api/visits/details", contact)) onDone?.(contact);
      return;
    }
    setStage("message");
  }
  async function sendMessage() {
    if (!msg.trim()) { setErr("Please write your message first."); return; }
    const body: Record<string, unknown> = { clientId, body: msg.trim() };
    if (!hasContact) body.contact = contact;
    if (await post("/api/visits/message", body)) setStage("sent");
  }

  const fld = (label: string, key: "name" | "address" | "email" | "mobile", type = "text", ph = "") => (
    <label className="wz-field" key={key}>
      <span>{label}</span>
      <input type={type} value={det[key]} placeholder={ph} autoComplete={key === "address" ? "street-address" : key === "mobile" ? "tel" : key} inputMode={key === "mobile" ? "tel" : undefined}
        onChange={(e) => setDet({ ...det, [key]: e.target.value })} data-testid={`talk-${key}`} />
    </label>
  );

  return (
    <div className="wz-sheetback" role="dialog" aria-modal="true" aria-label={mode === "visit" ? "Request a site visit" : mode === "call" ? "Speak with us" : mode === "details" ? "A few details first" : "Send us a message"} data-testid="talk-sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wz-sheet">
        {stage === "sent" ? (
          <>
            <div className="wz-sent-status" aria-hidden="true">✓</div>
            <h2>{mode === "visit" ? "Thank you, we have your request" : mode === "call" ? "Thank you, we will call you" : "Thank you, your message is with us"}</h2>
            <p className="wz-sub" data-testid="talk-sent">{mode === "visit" ? "We will be in touch within one working day to arrange your site visit." : mode === "call" ? `We will call you on ${det.mobile.trim()} within one working day to finalise your booking.` : "We will reply within one working day."}</p>
            <button type="button" className="wz-btn wz-bp" onClick={onClose} data-testid="talk-close">Done</button>
          </>
        ) : stage === "details" ? (
          <>
            <h2>A few details first</h2>
            <p className="wz-sub">{mode === "visit" ? "Tell us where the property is and how to reach you, and we will arrange a visit." : mode === "call" ? "We need these to call you and finalise your booking." : mode === "details" ? "We will save your estimate so you can come back to it." : "So we can save your estimate and reply to you."}</p>
            {fld("Full name", "name")}
            {needAddress && fld("Address of the property", "address")}
            {fld("Email", "email", "email")}
            {fld("Mobile number", "mobile", "tel", "04")}
            {mode === "visit" && (
              <label className="wz-field"><span>What would you like painted? (optional)</span>
                <textarea value={det.note} onChange={(e) => setDet({ ...det, note: e.target.value })} data-testid="talk-note" rows={3} /></label>
            )}
            {err && <p className="wz-err" role="alert" data-testid="talk-error">{err}</p>}
            <button type="button" className="wz-btn wz-bp" disabled={busy} onClick={() => void afterDetails()} data-testid="talk-go">
              {mode === "visit" ? "Send my request" : mode === "call" ? "Request a call" : mode === "details" ? "Continue" : "Continue to your message"}
            </button>
            <button type="button" className="wz-linkish" onClick={onClose} data-testid="talk-back">Back</button>
          </>
        ) : (
          <>
            <h2>Send us a message</h2>
            <p className="wz-sub">Tell us a little about your project and we will reply by email or phone.</p>
            <label className="wz-field"><span>Your message</span>
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={5} data-testid="talk-message" /></label>
            {err && <p className="wz-err" role="alert" data-testid="talk-error">{err}</p>}
            <button type="button" className="wz-btn wz-bp" disabled={busy} onClick={() => void sendMessage()} data-testid="talk-send">Send my message</button>
            <button type="button" className="wz-linkish" onClick={onClose} data-testid="talk-back">Back</button>
          </>
        )}
      </div>
    </div>
  );
}
