"use client";

import { useState } from "react";
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
  payload, quick, estimateId, onTighten, onBook, onKeep, phone,
}: {
  payload: CustomerPayload;
  quick: QuickLook;
  estimateId: string;
  onTighten: () => void;
  onBook: () => void;
  onKeep: () => void;
  phone: string | null;
}) {
  const [openAssumed, setOpenAssumed] = useState(false);
  const assumptions = assumedList(quick);

  return (
    <div className="wz-wrap wz-reveal" data-testid="reveal" data-estimate-id={estimateId}>
      <p className="wz-kick">Your guide range</p>

      <div className="wz-range" data-testid="reveal-range">
        {fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}
      </div>
      <p className="wz-range-note">
        Includes GST. Excludes access equipment and structural repairs.
      </p>

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
        <Door
          testId="door-keep" icon="✉" title="Keep this estimate" onClick={onKeep}
          body="We'll email a link so you can pick it up any time. The price is held for 60 days."
        />
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
