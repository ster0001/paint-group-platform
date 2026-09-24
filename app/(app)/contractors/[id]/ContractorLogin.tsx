"use client";

import { useState, useTransition } from "react";
import { sendContractorResetLinkAction, setContractorPasswordAction } from "../actions";

/**
 * Tom, 24 Sep 2026: "allow to manually update passwords and send reset links
 * for contractors". Two doors on the painter's page: a password the office
 * types and reads out over the phone, or an emailed link that lands on
 * /reset-password where the painter chooses their own.
 */
export default function ContractorLogin({ id, email }: { id: string; email: string | null }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, clear = false) => {
    setMsg(null);
    startTransition(async () => {
      const r = await fn().catch(() => ({ ok: false, message: "That didn't work — try again." }));
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok && clear) setPw("");
    });
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="card-login">
      <h2 className="text-sm font-semibold">Their login</h2>
      <p className="mt-1 text-xs text-gray-500">
        {email ? <>They sign in at /login as <b>{email}</b>.</> : "Their login has no email address on it."} Locked out? Email them a reset link, or set a password here and read it out over the phone.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="password" autoComplete="new-password" minLength={8} placeholder="New password (8+ characters)"
          value={pw} onChange={(e) => setPw(e.target.value)}
          className="w-56 rounded-md border border-gray-300 px-2 py-1.5 text-sm" data-testid="login-newpw"
        />
        <button type="button" disabled={pending || pw.length < 8} onClick={() => run(() => setContractorPasswordAction({ id, password: pw }), true)}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="login-setpw">
          Set password
        </button>
        <button type="button" disabled={pending || !email} onClick={() => run(() => sendContractorResetLinkAction({ id }))}
          className="rounded-md border border-cyan-600 px-3 py-1.5 text-sm font-medium text-cyan-700 hover:bg-cyan-50 disabled:opacity-50" data-testid="login-reset">
          Email a reset link
        </button>
      </div>
      {msg && <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="login-msg">{msg.text}</p>}
    </section>
  );
}
