"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deferCertificatesAction } from "./workerActions";

/**
 * "I will add this later" (induction Module 1, ruling I5): the painter goes on
 * with the induction without their certificates. The field stays empty and
 * shows as Missing; the office is reminded on their record and in PC Command;
 * the painter is texted on days 2, 4 and 6 until it is in. Job offers wait.
 */
export default function DeferCertificates({ deferredAt }: { deferredAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (deferredAt) {
    return <p className="hint" style={{ padding: 0 }} data-testid="certificates-deferred">You said you would add this later — we will text you a reminder. Job offers start once it is in.</p>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn narrow gh" disabled={busy} data-testid="certificates-later"
        onClick={async () => { setBusy(true); const r = await deferCertificatesAction(); setBusy(false); setMessage(r.message); if (r.ok) router.refresh(); }}>
        {busy ? "…" : "I will add this later"}
      </button>
      {message && <span className="hint" style={{ padding: 0 }} role="status" data-testid="certificates-later-msg">{message}</span>}
    </span>
  );
}
