"use client";

import { useEffect, useState } from "react";

/**
 * C8 — the Save & book sheet (prototype `sheet-save`).
 *
 * Opens from the pill in the header of every screen, from screen 1's "Book
 * someone in", and from the "both" choice. Email is required (it is the
 * magic link, ⚑26), mobile optional, four offered windows optional. Two ways
 * out — "Save and book" with a time, "Call me back" without — and the phone
 * number for the people who would rather just ring.
 *
 * It POSTs to /api/wizard/save-and-book and says only what happened: saved,
 * booked, emailed — never more. The words come back from the server's
 * answer, not from what the button hoped.
 */
export default function SaveAndBookSheet({
  open, onClose, phone, screen, estimateId, prefill, onSaved, snapshot,
}: {
  /** The walk as it stands, so the route can create the session if the flush has not landed. */
  snapshot?: { state: unknown; page: number; lastPage: number };
  open: boolean;
  onClose: () => void;
  phone: string | null;
  /** The resume point: the quick-look step or page label the customer is on. */
  screen: string;
  estimateId: string | null;
  prefill?: { email?: string; phone?: string; name?: string };
  /** Called once the server has kept the session, so the caller can flush the draft's tag. */
  onSaved?: () => void;
}) {
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [mobile, setMobile] = useState(prefill?.phone ?? "");
  const [name, setName] = useState(prefill?.name ?? "");
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<"book" | "call" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ booked: boolean; emailed: boolean; bookingProblem: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/wizard/save-and-book")
      .then((r) => r.json()).then((j: { slots?: string[] }) => { if (!cancelled) setSlots(j.slots ?? []); })
      .catch(() => { /* no slots is fine — "call me back" still works */ });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;

  async function submit(kind: "book" | "call") {
    if (busy) return;
    setError(null);
    if (!email.includes("@")) { setError("We need an email for the link back to your estimate."); return; }
    setBusy(kind);
    try {
      const res = await fetch("/api/wizard/save-and-book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(), phone: mobile.trim() || undefined, name: name.trim() || undefined,
          slot: kind === "book" ? slot ?? undefined : undefined, screen, estimateId: estimateId ?? undefined,
          snapshot,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; booked?: boolean; emailed?: boolean; bookingProblem?: string | null };
      if (!res.ok) { setError(j.error ?? "That didn't save — try again in a moment."); return; }
      setDone({ booked: j.booked === true, emailed: j.emailed === true, bookingProblem: j.bookingProblem ?? null });
      onSaved?.();
    } catch {
      setError("That didn't save — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wz-sheetback" role="dialog" aria-modal="true" aria-label="Save and book a person" data-testid="save-and-book" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wz-sheet">
        {done ? (
          <>
            <h2>Saved — a person has it</h2>
            <p className="wz-sub" data-testid="save-and-book-done">
              {done.booked
                ? <>You&rsquo;re booked for <b>{slot}</b>. </>
                : done.bookingProblem
                  ? <>{done.bookingProblem} </>
                  : <>One of us will be in touch to arrange a time. </>}
              {done.emailed
                ? <>The link back to your estimate is on its way to <b>{email.trim()}</b> — it opens exactly where you left off.</>
                : <>Everything you entered is saved to <b>{email.trim()}</b>. The email is taking its time; nothing is lost.</>}
            </p>
            <button type="button" className="wz-btn wz-bp" onClick={onClose} data-testid="save-and-book-close">Done</button>
          </>
        ) : (
          <>
            <h2>Save and book a person</h2>
            <p className="wz-sub">
              We keep everything you&rsquo;ve entered so far, and a person picks it up from exactly here. Nothing to repeat.
            </p>
            <input className="wz-field" type="email" inputMode="email" autoComplete="email" placeholder="Your email — for the link back" value={email}
              onChange={(e) => setEmail(e.target.value)} data-testid="sab-email" />
            <div className="wz-crow">
              <input className="wz-field" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} data-testid="sab-name" />
              <input className="wz-field" placeholder="Mobile (optional)" inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} data-testid="sab-phone" />
            </div>
            {slots.length > 0 && (
              <>
                <p className="wz-qhead">Pick a time, if you&rsquo;d like a visit</p>
                <div className="wz-slots" data-testid="sab-slots">
                  {slots.map((s) => (
                    <button key={s} type="button" className={`wz-slot ${slot === s ? "on" : ""}`} onClick={() => setSlot(slot === s ? null : s)} data-testid="sab-slot">
                      <b>{s.includes(" · ") ? s.slice(0, s.indexOf(" · ")) : s}</b>
                      {s.includes(" · ") && <span>{s.slice(s.indexOf(" · ") + 3)}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {error && <div className="wz-err" data-testid="sab-error">{error}</div>}
            <div className="wz-sheet-row">
              <button type="button" className="wz-btn wz-bp" disabled={busy != null || (slots.length > 0 && !slot)} onClick={() => submit("book")} data-testid="sab-book"
                title={slots.length > 0 && !slot ? "Pick a time first, or ask us to call" : undefined}>
                {busy === "book" ? "Saving…" : "Save and book"}
              </button>
              <button type="button" className="wz-btn wz-bs2" disabled={busy != null} onClick={() => submit("call")} data-testid="sab-call">
                {busy === "call" ? "Saving…" : "Call me back"}
              </button>
            </div>
            {phone && (
              <p className="wz-chint">Or just call — <a href={`tel:${phone.replace(/\s+/g, "")}`} data-testid="sab-phone-link">{phone}</a></p>
            )}
            <button type="button" className="wz-sheet-close" onClick={onClose} data-testid="sab-close">CLOSE</button>
          </>
        )}
      </div>
    </div>
  );
}
