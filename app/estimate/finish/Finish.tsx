"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  NOT_INCLUDED, finishOptions, summaryRows,
  type SummaryInput,
} from "@/lib/wizard/finish-line";

/**
 * SCREEN 10 — "Your detailed range: confirm or send."
 *
 * The plan's finish line (§3, §9.5). Until now the editor's CTA did all of
 * this in one button at the bottom of a long scroll: accept, or open a
 * contact form. That is fine as a mechanism and poor as a moment — the
 * customer is about to commit to a number and has nothing in front of them
 * to check it against.
 *
 * So this screen does three things and nothing else: shows the range they
 * have earned, reads their own answers back with a way to change each one,
 * and offers the fixing options the LADDER chose (never re-derived here).
 */

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

export default function Finish({
  estimateId, input, fixedPriceCents, companyPhone, busy = false,
}: {
  estimateId: string;
  input: SummaryInput;
  /** The single number a self-serve customer would be accepting. */
  fixedPriceCents: number;
  companyPhone: string | null;
  busy?: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { payload } = input;
  const rows = summaryRows(input);
  const options = finishOptions(payload, fmt(fixedPriceCents));

  async function choose(key: string) {
    if (sending || busy) return;
    // A visit is a conversation, not a commitment — it goes back to the
    // editor's reach strip, which already owns slots and call-backs.
    if (key === "book_visit") { router.push(`/estimate/scope?id=${estimateId}#reach`); return; }
    setSending(key);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept_intent" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "That didn't send — try again in a moment.");
        setSending(null);
        return;
      }
      router.push(`/estimate/sent?id=${estimateId}`);
    } catch {
      setError("That didn't send — check your connection and try again.");
      setSending(null);
    }
  }

  return (
    <div className="wz-wrap wz-finish" data-testid="finish">
      <p className="wz-kick">Your detailed range</p>
      <div className="wz-range" data-testid="finish-range">
        {fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}
      </div>
      <p className="wz-range-note">
        Includes GST · {input.roomsConfirmed} of {input.roomsTotal} {input.roomsTotal === 1 ? "room" : "rooms"} confirmed
      </p>

      <div className="wz-tiers" data-testid="finish-tiers">
        <span className={payload.bandPct >= 15 ? "on" : ""}>Guide</span>
        <span className={payload.bandPct < 15 ? "on" : ""}>Detailed</span>
        <span>Confirmed</span>
      </div>

      <h2 className="wz-doors-head">Make it a fixed price</h2>
      <div className="wz-doors">
        {options.map((o) => (
          <button
            key={o.key} type="button" className="wz-door" data-testid={`finish-${o.key}`}
            disabled={sending != null || busy}
            onClick={() => void choose(o.key)}
          >
            <span className="wz-door-icon" aria-hidden="true">{o.icon}</span>
            <span className="wz-door-text">
              <b>{sending === o.key ? "Sending…" : o.title}</b>
              <span>{o.body}</span>
            </span>
            <span className="wz-door-go" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      {error && <p className="wz-err" data-testid="finish-error">{error}</p>}

      <h2 className="wz-doors-head">What you&rsquo;ve told us</h2>
      <ul className="wz-summary" data-testid="finish-summary">
        {rows.map((r) => (
          <li key={r.key} data-testid={`finish-row-${r.key}`}>
            <span>{r.text}</span>
            {/* Every row is changeable. A summary you can only read is a
                receipt; one you can act on is a last chance to be right. */}
            <a className="wz-linkish" href={`/estimate/scope?id=${estimateId}#${r.card}`}>Change</a>
          </li>
        ))}
      </ul>

      <p className="wz-notincluded" data-testid="finish-excluded">{NOT_INCLUDED}</p>

      {companyPhone && (
        <p className="wz-reveal-call">
          <a href={`tel:${companyPhone.replace(/[^0-9+]/g, "")}`}>Call {companyPhone}</a>
          {" · "}
          <a href={`/estimate/scope?id=${estimateId}#reach`}>Request a call back</a>
        </p>
      )}
      <p className="wz-reveal-call">
        <a className="wz-linkish" href={`/estimate/scope?id=${estimateId}`}>← Back to your estimate</a>
      </p>
    </div>
  );
}
