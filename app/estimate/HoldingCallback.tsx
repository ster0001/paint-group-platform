"use client";

import { useState } from "react";

/**
 * The holding page's "call me" form (Phase 0 of the 6 Sep estimator plan).
 *
 * While online estimates are switched off, a visitor who typed an address on
 * the homepage arrives here. Instead of a closed door they leave a name,
 * phone and email; the office gets a "requested a call" item on Today. The
 * address they typed rides along so the office rings knowing the property.
 */
export default function HoldingCallback({ address, companyPhone }: { address: string; companyPhone: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = name.trim().length > 0 && phone.replace(/[^0-9+]/g, "").length >= 8 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const tel = companyPhone ? `tel:${companyPhone.replace(/\s+/g, "")}` : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/wizard/callback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), email: email.trim(), address: address.trim() || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok && j.error) { setError(j.error); return; }
      if (res.status === 429) { setError("That's a few requests in a row — give it a minute, or ring us."); return; }
      setSent(true);
    } catch {
      setError("That didn't go through — check the connection and try again, or ring us.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="wz-hold-done" data-testid="holding-sent">
        <p className="wz-q">Thanks {name.trim().split(/\s+/)[0]} — we&rsquo;ll call you on {phone.trim()} during business hours.</p>
        <p className="wz-sub" style={{ marginTop: 8 }}>{address.trim() ? <>We&rsquo;ve noted the address: {address.trim()}.</> : <>We&rsquo;ve got your details.</>}</p>
      </div>
    );
  }

  return (
    <form className="wz-hold-form" onSubmit={submit} data-testid="holding-form">
      <p className="wz-qhead">Leave your details and we&rsquo;ll call you</p>
      <div className="wz-crow">
        <input className="wz-field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <input className="wz-field" placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        <input className="wz-field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      {address.trim() && <p className="wz-chint">For {address.trim()}</p>}
      <button type="submit" className="wz-btn wz-bp" disabled={!ok || busy} data-testid="holding-send" style={{ marginTop: 12 }}>
        {busy ? "Sending…" : "Call me"}
      </button>
      {tel && (
        <p className="wz-chint" style={{ marginTop: 12 }}>
          Or ring us now on <a href={tel} style={{ color: "var(--text)" }}>{companyPhone}</a>.
        </p>
      )}
      {error && <div className="wz-err" role="alert">{error}</div>}
    </form>
  );
}
