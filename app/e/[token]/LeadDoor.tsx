"use client";

import { useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { DoorTo } from "@/lib/estimate/leadDoorPath";

/**
 * The lead page's door (Tom, 17 Nov 2026 — where L5, L6 and L7 land). Carry
 * on opens the quote stage, Book a visit opens the visit page. The browser
 * that built the draft goes straight through; any other gets a six-digit
 * code texted to the mobile on file (the server picks the number, never this
 * page), and the right code opens the draft here. /api/lead/[token]/door is
 * the one route; this only asks it and follows `next`.
 */
type Reply = { status?: "open" | "code" | "sent"; next?: string; masked?: string; error?: string; code?: string };

async function ask(token: string, body: Record<string, string>): Promise<{ http: number; r: Reply }> {
  const res = await fetch(`/api/lead/${encodeURIComponent(token)}/door`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const r = (await res.json().catch(() => ({}))) as Reply;
  return { http: res.status, r };
}

/** A session is needed to hold a door: an anonymous one if this browser has none. */
async function ensureSession(): Promise<boolean> {
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;
  const { error } = await supabase.auth.signInAnonymously();
  return !error;
}

export default function LeadDoor({ token, biggerJob }: { token: string; biggerJob: boolean }) {
  const [to, setTo] = useState<DoorTo | null>(null);
  const [phase, setPhase] = useState<"idle" | "code" | "sent">("idle");
  const [masked, setMasked] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = ({ http, r }: { http: number; r: Reply }) => {
    if (r.status === "open" && r.next) { window.location.assign(r.next); return; }
    if (r.status === "code" || r.status === "sent") { setMasked(r.masked ?? ""); setPhase(r.status); setError(null); return; }
    setError(r.error ?? (http === 404 ? "This link has expired — please call us." : "Something went wrong — please try again."));
  };

  const start = async (where: DoorTo) => {
    setTo(where); setBusy(true); setError(null);
    try {
      if (!(await ensureSession())) { setError("We couldn't start a session here — please reload the page."); return; }
      handle(await ask(token, { action: "open", to: where }));
    } catch { setError("We couldn't connect just now — check your connection and try again."); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!to) return;
    setBusy(true); setError(null);
    try { handle(await ask(token, { action: "send", to })); }
    catch { setError("We couldn't send the code — check your connection and try again."); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    if (!to || !/^\d{6}$/.test(code)) { setError("Enter the six-digit code."); return; }
    setBusy(true); setError(null);
    try { handle(await ask(token, { action: "verify", to, code })); }
    catch { setError("We couldn't check the code — check your connection and try again."); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="lead-door" data-busy={busy ? "1" : "0"}>
      <div className="cta-row print-hide">
        {!biggerJob && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start("quote")} data-testid="lead-carry-on">Tighten my range</button>
        )}
        <button type="button" className={`btn ${biggerJob ? "btn-primary" : "btn-ghost"}`} disabled={busy} onClick={() => void start("visit")} data-testid="lead-book-visit">Book a visit</button>
      </div>
      {phase !== "idle" && (
        <div className="field" style={{ marginTop: 16, maxWidth: 360 }} data-testid="lead-code">
          {phase === "code" ? (
            <>
              <p className="viewnote" style={{ marginTop: 0 }}>To open your answers on this device, we&apos;ll text a code to {masked}.</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send()} data-testid="lead-code-send">Text me a code</button>
            </>
          ) : (
            <>
              <label htmlFor="lead-code-input" className="viewnote" style={{ display: "block", marginTop: 0 }}>We&apos;ve texted a code to {masked}.</label>
              <input
                id="lead-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") void verify(); }}
                data-testid="lead-code-input"
              />
              <div className="cta-row" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void verify()} data-testid="lead-code-verify">Open</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void send()} data-testid="lead-code-resend">Send it again</button>
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="viewnote" role="alert" style={{ color: "var(--amber)" }} data-testid="lead-door-error">{error}</p>}
    </div>
  );
}
