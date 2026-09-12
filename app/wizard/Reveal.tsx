"use client";

import { useState } from "react";
import WhatWeDo from "./WhatWeDo";
import { assumedList, restatement, type QuickLook } from "@/lib/wizard/quick-look";
import type { CustomerPayload } from "@/lib/wizard/view";

/**
 * THE GUIDE RANGE — estimator journey v2 §3, "the screen the redesign exists
 * for".
 *
 * Everything before this is four screens of taps; everything after it is
 * optional. Three things have to be true here or the whole flow fails:
 *
 *   1. **A range, never a number.** A single figure from nine taps would be a
 *      promise we cannot keep, and the customer would hold us to it.
 *   2. **The premise is visible.** A range with no stated basis cannot be
 *      checked, so their own answers are read back underneath it, and every
 *      assumption we made for them is listed and tappable. A hidden
 *      assumption is a trap; a listed one is a shortcut they can take back.
 *   3. **Three doors, no hierarchy.** §1: *"both doors — book a person,
 *      tighten online — sit on the same screen, with no hierarchy between
 *      them."* Time-poor customers are not a lesser outcome; they are one of
 *      the three customers this serves.
 *
 * ⚑ This screen reverses Tom's 28 Aug ruling ("no interstitial result screen
 * — a revealed estimate goes STRAIGHT to the confirm-loop editor"). That
 * ruling was right for a wizard whose price arrived after 25-30 answers and a
 * contact form: by then the customer had already committed, and another
 * screen was a toll. It is wrong for a flow whose whole promise is a number
 * in under a minute with no commitment — here the reveal IS the product, and
 * dropping someone straight into a room-by-room editor is what §2.7 calls
 * "nine amber cards that all look equally urgent".
 */

const fmt = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

export default function Reveal({
  payload, quick, estimateId, onTighten, onBook, phone, prefillEmail,
}: {
  payload: CustomerPayload;
  quick: QuickLook;
  estimateId: string;
  onTighten: () => void;
  onBook: () => void;
  phone: string | null;
  /** A signed-in member already gave us this — don't ask again. */
  prefillEmail?: string;
}) {
  const [openAssumed, setOpenAssumed] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [keeping, setKeeping] = useState(false);
  const [kept, setKept] = useState<{ emailed: boolean } | null>(null);
  const [keepError, setKeepError] = useState<string | null>(null);
  const assumptions = assumedList(quick);

  /**
   * ⚑1's gate, in the one place a customer actually wants to give an address:
   * they have seen a number and want it back later. The button must never
   * claim more than happened — if the send fails, the estimate is still saved
   * and we say so, rather than promising an email that is not coming.
   */
  async function keep() {
    if (keeping) return;
    setKeeping(true);
    setKeepError(null);
    try {
      const res = await fetch("/api/wizard/keep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateId, email: email.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setKeepError(j.error ?? "That didn't save — try again in a moment."); return; }
      setKept({ emailed: j.emailed === true });
    } catch {
      setKeepError("That didn't save — check your connection and try again.");
    } finally {
      setKeeping(false);
    }
  }

  return (
    <div className="wz-wrap wz-reveal" data-testid="reveal" data-estimate-id={estimateId}>
      <p className="wz-kick">Your guide range</p>

      <div className="wz-range" data-testid="reveal-range">
        {fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}
      </div>
      <p className="wz-range-note">
        Includes GST. Excludes access equipment and structural repairs.
      </p>
      {/* C8 (⚑25): a "both" job — inside and outside, each its own range; the
          figure above is the two together. */}
      {payload.parts && (
        <div className="wz-parts" data-testid="reveal-parts">
          <div className="wz-part" data-testid="reveal-part-interior">
            <span>Inside</span>
            <b>{fmt(payload.parts.interior.rangeLoCents)} – {fmt(payload.parts.interior.rangeHiCents)}</b>
          </div>
          <div className="wz-part" data-testid="reveal-part-exterior">
            <span>Outside</span>
            <b>{fmt(payload.parts.exterior.rangeLoCents)} – {fmt(payload.parts.exterior.rangeHiCents)}</b>
          </div>
        </div>
      )}

      {/* Guide → Detailed → Confirmed. The plan's one piece of progression:
          "the only progression the customer sees is the range narrowing and
          three honest words". Never points, never a badge. */}
      <div className="wz-tiers" data-testid="reveal-tiers">
        <span className="on">Guide</span>
        <span>Detailed</span>
        <span>Confirmed</span>
      </div>

      <p className="wz-restate" data-testid="reveal-restatement">{restatement(quick)}</p>

      <button
        type="button"
        className="wz-assumed-head"
        aria-expanded={openAssumed}
        data-testid="reveal-assumed-toggle"
        onClick={() => setOpenAssumed((v) => !v)}
      >
        <span>What we&rsquo;ve assumed</span>
        <em>{openAssumed ? "Hide" : `${assumptions.length} things`}</em>
      </button>
      {openAssumed && (
        <ul className="wz-assumed" data-testid="reveal-assumed">
          {assumptions.map((a) => (
            <li key={a.key} data-testid={`reveal-assumed-${a.key}`}>
              <b>{a.what}</b>
              <span>{a.why}</span>
            </li>
          ))}
        </ul>
      )}

      {/* C9 — the coats and prep the engine derived, in plain English, no
          controls. What changes it is the job screen and the details screen. */}
      <WhatWeDo lines={payload.systems ?? []} tellUsHref={`/estimate/scope?id=${estimateId}#reach`} />

      {/* The estimator has not seen this yet, and the customer should hear
          that from us rather than discover it. */}
      {payload.walkthroughRequired && (
        <p className="wz-reveal-flag" data-testid="reveal-flag">
          One of our estimators will look this over before any price is fixed.
        </p>
      )}

      <h2 className="wz-doors-head">Where would you like to go from here?</h2>
      <div className="wz-doors">
        <Door
          testId="door-tighten" icon="◫" title="Tighten it online" onClick={onTighten}
          body={`Confirm the rooms, the surfaces and the condition. About five minutes, with photos if you like — narrows this to within about ${payload.tightBand ? 4 : 8}%.`}
        />
        <Door
          testId="door-book" icon="☎" title="Book your estimator" onClick={onBook}
          body="A visit or a call, whichever suits. We bring your answers with us, so it's quick."
        />
        {kept ? (
          <p className="wz-kept" data-testid="reveal-kept">
            {kept.emailed
              ? <>Saved, and the link is on its way to <b>{email.trim()}</b>. It opens straight to this price.</>
              : <>Saved to <b>{email.trim()}</b>. The email is taking its time — you can carry on here, and it&rsquo;ll be waiting in your account.</>}
          </p>
        ) : !keepOpen ? (
          <Door
            testId="door-keep" icon="✉" title="Keep this estimate" onClick={() => setKeepOpen(true)}
            body="We'll email a link so you can pick it up any time. The price is held for 60 days."
          />
        ) : (
          <div className="wz-keep" data-testid="reveal-keep-form">
            <p className="wz-keep-q">Where should we send it?</p>
            <input
              className="wz-in" type="email" inputMode="email" autoComplete="email"
              placeholder="Your email" value={email} data-testid="reveal-keep-email"
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="wz-keep-row">
              <button
                type="button" className="wz-btn wz-bp" data-testid="reveal-keep-send"
                disabled={keeping || !email.includes("@")}
                onClick={() => void keep()}
              >{keeping ? "Saving…" : "Email me the link"}</button>
              <button type="button" className="wz-linkish" onClick={() => { setKeepOpen(false); setKeepError(null); }}>
                Not now
              </button>
            </div>
            {keepError && <p className="wz-err" data-testid="reveal-keep-error">{keepError}</p>}
            <p className="wz-keep-note">
              For your estimate — we won&rsquo;t pass it on, and you can ask us to forget it any time.
            </p>
          </div>
        )}
      </div>

      {phone && (
        <p className="wz-reveal-call">
          Or just talk to us — <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`}>{phone}</a>
        </p>
      )}
    </div>
  );
}

function Door({ icon, title, body, onClick, testId }: {
  icon: string; title: string; body: string; onClick: () => void; testId: string;
}) {
  return (
    <button type="button" className="wz-door" onClick={onClick} data-testid={testId}>
      <span className="wz-door-icon" aria-hidden="true">{icon}</span>
      <span className="wz-door-text">
        <b>{title}</b>
        <span>{body}</span>
      </span>
      <span className="wz-door-go" aria-hidden="true">›</span>
    </button>
  );
}
