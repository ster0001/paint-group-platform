"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * C15 (A2) — "Open the sheet": the quote is created by the one submit route
 * every wizard walk goes through, with the state the server prepared
 * (property, spec, address). No money is computed or shown here — the range
 * on this screen came from the server, and the sheet re-reads it.
 */
export default function OpenSheet({ state, label = "Open the sheet" }: { state: unknown; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/wizard/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const j = (await res.json().catch(() => ({}))) as { estimateId?: string; error?: string; message?: string; outcome?: string };
      if (!res.ok) { setError(j.error ?? "That didn't open — try again."); setBusy(false); return; }
      if (!j.estimateId) { setError(j.message ?? "We couldn't start that quote — give us a call."); setBusy(false); return; }
      router.push(`/account/quote/${j.estimateId}/sheet`);
    } catch {
      setError("That didn't open — check your connection and try again."); setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-cyan" onClick={open} disabled={busy} data-testid="open-sheet" style={{ width: "100%" }}>
        {busy ? "Opening…" : label}
      </button>
      {error && <p className="sub" role="alert" style={{ marginTop: 8, color: "var(--clay, #b45309)" }}>{error}</p>}
    </div>
  );
}
