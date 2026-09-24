"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** New password, typed twice, saved through the signed-in user's own session. */
export default function ResetPasswordForm({ home }: { home: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) { setMsg({ ok: false, text: "Use at least 8 characters." }); return; }
    if (pw !== pw2) { setMsg({ ok: false, text: "Those two don't match — have another go." }); return; }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: "That didn't save — please try again in a moment." }); return; }
    setMsg({ ok: true, text: "Password saved. Taking you in…" });
    router.push(home);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-5 space-y-4" data-testid="reset-password-form">
      <label className="block text-sm font-medium" htmlFor="pw-new">New password
        <input id="pw-new" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" data-testid="reset-pw" />
      </label>
      <label className="block text-sm font-medium" htmlFor="pw-confirm">Type it again
        <input id="pw-confirm" type="password" autoComplete="new-password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" data-testid="reset-pw2" />
      </label>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`} data-testid="reset-msg">{msg.text}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="reset-submit">
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
