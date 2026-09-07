"use client";

import { useEffect, useState } from "react";

/**
 * Tom, 8 Sep 2026: "they have to answer all of the questions to be able to
 * finalise their booking — they should be able to click at the bottom to book
 * a site visit, call us or request a call back at any time."
 *
 * Three ways to reach a person, on every page, needing only a name and a
 * phone number (an email is welcome — it is where the visit invite goes).
 * Everything goes through /api/wizard/reach, which links the request to the
 * open draft so the office sees the answers so far.
 */
export type HelpDefaults = { name: string; phone: string; email: string };
type Mode = "idle" | "callback" | "visit";
type Win = { key: string; label: string };

export default function HelpBar({ companyPhone, page, pageLabel, defaults, address }: {
  companyPhone: string | null;
  page: number;
  pageLabel: string;
  defaults: HelpDefaults;
  address?: { street: string; suburb: string; postcode: string; state?: string } | null;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  // What the person types here wins; until they do, the contact page's
  // answers (typed later or earlier) show through — no effect needed.
  const [nameEdit, setName] = useState<string | null>(null);
  const [phoneEdit, setPhone] = useState<string | null>(null);
  const [emailEdit, setEmail] = useState<string | null>(null);
  const name = nameEdit ?? defaults.name;
  const phone = phoneEdit ?? defaults.phone;
  const email = emailEdit ?? defaults.email;
  const [windows, setWindows] = useState<Win[] | null>(null);
  const [windowKey, setWindowKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "visit" || windows) return;
    let live = true;
    fetch("/api/wizard/reach?windows=1", { cache: "no-store" })
      .then((r) => r.json()).then((j: { windows?: Win[] }) => { if (live) setWindows(j.windows ?? []); })
      .catch(() => { if (live) setWindows([]); });
    return () => { live = false; };
  }, [mode, windows]);

  const phoneOk = phone.replace(/[^0-9]/g, "").length >= 8;
  const canSend = name.trim().length > 0 && phoneOk && (mode === "callback" || windowKey);

  async function send() {
    if (!canSend || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/wizard/reach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: mode, name: name.trim(), phone: phone.trim(), email: email.trim(), windowKey: mode === "visit" ? windowKey : undefined, page, pageLabel, address: address ?? undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok) { setDone(j.message ?? "Done."); setMode("idle"); }
      else { setError(j.error ?? "That didn't go through — try again, or call us."); if (j.why === "not booked") setWindows(null); }
    } catch { setError("That didn't go through — check the connection and try again."); }
    finally { setBusy(false); }
  }

  const tel = companyPhone ? `tel:${companyPhone.replace(/[^0-9+]/g, "")}` : null;

  return (
    <div className="wz-help" data-testid="wz-help">
      {done && <p className="wz-help-done" data-testid="wz-help-done">{done}</p>}
      <div className="wz-help-row">
        <span className="wz-help-lead">Rather talk to a person? Any time:</span>
        <button type="button" className={`wz-help-btn ${mode === "visit" ? "on" : ""}`} onClick={() => { setMode(mode === "visit" ? "idle" : "visit"); setError(null); }} data-testid="wz-help-visit">Book a site visit</button>
        {tel
          ? <a className="wz-help-btn" href={tel} data-testid="wz-help-call">Call us{companyPhone ? ` · ${companyPhone}` : ""}</a>
          : null}
        <button type="button" className={`wz-help-btn ${mode === "callback" ? "on" : ""}`} onClick={() => { setMode(mode === "callback" ? "idle" : "callback"); setError(null); }} data-testid="wz-help-callback">Request a call back</button>
      </div>
      {mode !== "idle" && (
        <form className="wz-help-form" onSubmit={(e) => { e.preventDefault(); void send(); }} data-testid="wz-help-form">
          {mode === "visit" && (
            <div className="wz-help-windows" data-testid="wz-help-windows">
              {windows == null && <span className="wz-help-note">Finding times…</span>}
              {windows && windows.length === 0 && <span className="wz-help-note">No open times online right now — request a call back and we&rsquo;ll find one with you.</span>}
              {windows && windows.map((w) => (
                <button type="button" key={w.key} className={`wz-help-win ${windowKey === w.key ? "on" : ""}`} onClick={() => setWindowKey(w.key)} data-testid="wz-help-win">{w.label}</button>
              ))}
            </div>
          )}
          <div className="wz-help-fields">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" autoComplete="name" data-testid="wz-help-name" />
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" aria-label="Phone number" autoComplete="tel" data-testid="wz-help-phone" />
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={mode === "visit" ? "Email for the calendar invite (optional)" : "Email (optional)"} aria-label="Email" autoComplete="email" data-testid="wz-help-email" />
            <button type="submit" className="wz-btn wz-bp" disabled={!canSend || busy} data-testid="wz-help-send">
              {busy ? "Sending…" : mode === "visit" ? "Book it" : "Call me"}
            </button>
            <button type="button" className="wz-linkish" onClick={() => setMode("idle")}>Never mind</button>
          </div>
          {error && <p className="wz-help-err" role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
