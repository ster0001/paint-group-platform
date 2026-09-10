"use client";

import { useState } from "react";

/**
 * THE GATE — prototype screen `s-stop`, "Let's have someone look at this first".
 *
 * ⚑ WHAT WAS MISSING: this screen was a DEAD END. It said a person would be in
 * touch and gave the customer nothing to do about it — no button, no number,
 * and on the asbestos path we often do not even have their phone, because the
 * gate fires before the contact details are asked for. So the promise depended
 * on us having something we might not have.
 *
 * It now does the three things the prototype does:
 *   · says what WE will do, and by when
 *   · lets them ask for the call, with a number
 *   · offers the office's number for anyone who would rather ring now
 *
 * It posts to /api/wizard/outcome, which is keyed on the session rather than an
 * estimate id — deliberately, because a blocked submit never returns one.
 * That files the session as "Needs help", which is what puts it on Today.
 */

export default function HardStop({
  heading, message, why, companyPhone, turnaround = "within one working day", canRetry = false,
}: {
  heading: string;
  message: string;
  why?: string | null;
  companyPhone: string | null;
  turnaround?: string;
  canRetry?: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tel = companyPhone ? `tel:${companyPhone.replace(/[^0-9+]/g, "")}` : null;
  const phoneOk = phone.replace(/[^0-9]/g, "").length >= 8;

  async function request() {
    if (sending || !phoneOk) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/wizard/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "help_requested", phone: phone.trim(), note: note.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      // The route answers `{ ok: false, why }` quietly for a session it cannot
      // file. Telling somebody "requested ✓" on that would be the worst of it.
      if (!res.ok || j.ok === false) {
        setError("That didn't send — please ring us on the number above and we'll sort it out.");
        return;
      }
      setDone(true);
    } catch {
      setError("That didn't send — please ring us and we'll sort it out.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="wz-wrap wz-stop" data-testid="hard-stop">
      <p className="wz-kick">Before we go any further</p>
      <h1>{heading}</h1>
      <p className="wz-sub">{message}</p>
      {why && <p className="wz-q" data-testid="outcome-why">{why}</p>}

      <div className="wz-stop-what" data-testid="hard-stop-what">
        <b>What we&rsquo;ll do</b>
        <span>
          We&rsquo;ll call you {turnaround} to talk it through and arrange an assessment.
          Everything you&rsquo;ve told us is saved, so you won&rsquo;t have to repeat it.
        </span>
      </div>

      {done ? (
        <p className="wz-kept" data-testid="hard-stop-done">
          Asked for — we&rsquo;ll ring <b>{phone}</b> {turnaround}. Nothing else to do.
        </p>
      ) : (
        <div className="wz-stop-ask">
          <p className="wz-qhead" style={{ marginTop: 0 }}>Ask us to call</p>
          <input
            className="wz-in" type="tel" inputMode="tel" autoComplete="tel"
            placeholder="Your mobile number" value={phone} data-testid="hard-stop-phone"
            onChange={(e) => setPhone(e.target.value)}
          />
          <textarea
            className="wz-brief" rows={2} maxLength={400} value={note} data-testid="hard-stop-note"
            placeholder="Anything you'd like us to know first? (optional)"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="wz-stop-row">
            <button
              type="button" className="wz-btn wz-bp" disabled={!phoneOk || sending}
              data-testid="hard-stop-send" onClick={() => void request()}
            >{sending ? "Sending…" : "Request a call back"}</button>
            {tel && (
              <a className="wz-btn wz-bs" href={tel} data-testid="hard-stop-call">
                Call now {companyPhone}
              </a>
            )}
          </div>
          {error && <p className="wz-err" data-testid="hard-stop-error">{error}</p>}
        </div>
      )}

      {canRetry ? (
        <p style={{ marginTop: 18 }}>
          <a className="wz-linkish" href="/estimate">Try the quick questions instead</a>
        </p>
      ) : (
        <p className="wz-stop-note">
          We have everything you entered — nothing needs doing again.
        </p>
      )}
    </div>
  );
}
