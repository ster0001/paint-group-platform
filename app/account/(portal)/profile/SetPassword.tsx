"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Optional password on top of the magic link — set through the CUSTOMER'S OWN
 * session (supabase.auth.updateUser), so no password ever crosses our server.
 * Once set they can sign in at /login with email + password; the emailed
 * link keeps working either way.
 */
export default function SetPassword() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setMsg(null);
    if (pw.length < 8) { setMsg({ ok: false, text: "Use at least 8 characters." }); return; }
    if (pw !== pw2) { setMsg({ ok: false, text: "Those two don't match — have another go." }); return; }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: "That didn't save — please try again in a moment." });
      return;
    }
    setPw(""); setPw2("");
    setMsg({ ok: true, text: "Password set. You can now sign in with your email and password — the emailed link keeps working too." });
  }

  return (
    <div className="card">
      <h3>Password</h3>
      <p className="sub" style={{ marginBottom: 14 }}>
        You don&rsquo;t need one — the emailed sign-in link always works. But if you&rsquo;d
        rather sign in with a password, set one here.
      </p>
      <label htmlFor="pw-new">New password</label>
      <input
        id="pw-new" className="field" type="password" autoComplete="new-password"
        value={pw} onChange={(e) => setPw(e.target.value)} minLength={8}
      />
      <label htmlFor="pw-confirm" style={{ marginTop: 12 }}>Type it again</label>
      <input
        id="pw-confirm" className="field" type="password" autoComplete="new-password"
        value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8}
      />
      {msg && (
        <p className="sub" style={{ marginTop: 12, color: msg.ok ? "var(--emerald)" : "var(--amber)" }}>
          {msg.text}
        </p>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Set password"}
        </button>
      </div>
    </div>
  );
}
