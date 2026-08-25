"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCountdown, msRemaining } from "@/lib/scheduling/offers";

/**
 * Tom (25 Aug): an OFFERED job's work-order page carries the clock pinned to
 * the top with Accept / Decline right there — a contractor reading the scope
 * shouldn't have to walk back to Requests to answer. The countdown ticks
 * client-side; the database re-checks expiry on the actual response, so a
 * stale page can't sneak an answer in. "Propose a new date" stays on the
 * Requests card, which has the calendar.
 */

const DECLINE_REASON = "Not available";

export default function OfferBar({ offerId, expiresAt, priceCents }: {
  offerId: string;
  expiresAt: string | null;
  priceCents: number | null;
}) {
  const router = useRouter();
  const remaining = () => (expiresAt ? msRemaining(expiresAt) : Number.POSITIVE_INFINITY);
  const [left, setLeft] = useState(remaining);
  useEffect(() => {
    const t = setInterval(() => setLeft(remaining()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function respond(action: "accept" | "decline") {
    if (action === "decline" && !confirm("Decline this job? It goes straight back to Paint Group.")) return;
    setBusy(true);
    setErr("");
    try {
      const { data, error } = await createClient().rpc("respond_to_offer", {
        p_offer_id: offerId,
        p_action: action,
        p_note: "",
        p_proposed_start: null,
        p_decline_reason: action === "decline" ? DECLINE_REASON : "",
      });
      if (error) throw error;
      const result = String(data ?? "");
      if (result.startsWith("error:")) {
        setErr(result === "error:expired" ? "This offer has expired — it's gone back to Paint Group." : "Couldn't record that — try again.");
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setErr("Couldn't record that — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const expired = left <= 0;
  return (
    <div
      data-testid="offer-bar"
      style={{
        position: "sticky", top: 0, zIndex: 20, margin: "0 -2px 10px",
        background: "var(--graphite, #12161A)", border: "1px solid var(--line, #242B32)",
        borderRadius: 12, padding: "10px 12px",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 120 }}>
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted, #8C959D)" }}>
          {expired ? "Offer expired" : "Time to respond"}
        </div>
        <div data-testid="offer-countdown"
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 18, fontWeight: 600, color: expired ? "var(--clay, #B3574A)" : left < 2 * 3600_000 ? "var(--amber, #E0A83C)" : "var(--text, #EDF0F2)" }}>
          {expired ? "0:00:00" : Number.isFinite(left) ? formatCountdown(left) : "Open"}
        </div>
      </div>
      {priceCents != null && priceCents > 0 && (
        <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 14 }}>
          ${(priceCents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}
        </div>
      )}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button type="button" className="btn cy" disabled={busy || expired}
          onClick={() => respond("accept")} data-testid="offer-bar-accept">
          {busy ? "…" : "Accept — lock it in"}
        </button>
        <button type="button" className="btn gh" disabled={busy || expired}
          onClick={() => respond("decline")} data-testid="offer-bar-decline">
          Decline
        </button>
      </div>
      {err && <div style={{ width: "100%", fontSize: 12.5, color: "var(--clay, #B3574A)" }}>{err}</div>}
    </div>
  );
}
