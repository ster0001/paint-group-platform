"use client";

import { useState } from "react";
import WhatWeDo from "./WhatWeDo";
import EstimatorStrip from "./EstimatorStrip";
import { UI_FLAGS } from "@/lib/wizard/ui-flags";
import { assumedList, restatement, type QuickLook } from "@/lib/wizard/quick-look";
import { commercialAssumedList, commercialRestatement, openCount, type CommercialAnswers, type Segment } from "@/lib/wizard/segments";
import { exteriorAssumedList, exteriorRestatement, type ExteriorQuickLook } from "@/lib/wizard/exterior-quick-look";
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

/** Which assumed line each open envelope question belongs to (lib/wizard/envelope.ts). */
const OPEN_BY_KEY: Record<string, string[]> = { openings: ["doors", "windows"], height: ["height"], trims: ["trims"] };

export default function Reveal({
  payload, quick, estimateId, onTighten, onBook, phone, prefillEmail, commercial = null, outside = null, speakWithUs = false, onSpeak, onMessage, contactKnown = false,
  firstName = null, trust = null,
}: {
  /** UI refresh S3: the name from the details step, for "Alex, here's your guide range". */
  firstName?: string | null;
  /** ⚑ 5: the homepage's own claims — the Google rating and count from the same source, and its warranty line. Null pieces are left out, never invented. */
  trust?: { rating: number | null; count: number | null; url: string | null; warranty: string | null; warrantyNote: string | null } | null;
  payload: CustomerPayload;
  /** Visit booking S4 (R25/R34): decided on the server from the top of the range. */
  speakWithUs?: boolean;
  onSpeak?: () => void;
  onMessage?: () => void;
  /** S6: the details are held, so "Keep this estimate" (the old email door) has nothing to ask. */
  contactKnown?: boolean;
  quick: QuickLook;
  /** C12: a commercial job — the segment row and the answers, for the kicker,
   * the basis sentence and the segment's own assume list. */
  commercial?: { segment: Segment; answers: CommercialAnswers; photos: number } | null;
  /** C8b: the exterior quick look's answers — the basis sentence and assume
   * list for an OUTSIDE job never mention bedrooms. */
  outside?: ExteriorQuickLook | null;
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
  const exteriorOnly = quick.jobType === "exterior" && outside != null;
  const assumptions = commercial
    ? commercialAssumedList(commercial.segment, commercial.answers, commercial.photos)
    : exteriorOnly ? exteriorAssumedList(outside)
      : assumedList(quick);
  const basis = commercial ? commercialRestatement(commercial.segment, commercial.answers, quick)
    : exteriorOnly ? exteriorRestatement(outside)
      : restatement(quick);

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

  // UI refresh S3 (brief §7.4): the ladder. An exterior, a "both" or a commercial job is never
  // told about Confirmed (lib/wizard/ladder.ts) — they get two bars and the visit sentence.
  const insideOnly = quick.jobType === "interior" && !payload.commercial && !payload.parts;
  const how = payload.parts ? "room by room, then side by side" : exteriorOnly ? "side by side" : payload.commercial ? "area by area" : "room by room";
  // ⚑ 11: the Guide bar follows the live band; Detailed and Confirmed are illustrative, with no numbers.
  const guideBar = Math.max(40, Math.min(96, Math.round(payload.bandPct * 3)));
  const first = firstName?.trim().split(/\s+/)[0] ?? "";
  const kicker = payload.commercial ? `${payload.commercial.name} · your guide range` : first ? `${first}, here’s your guide range` : "Your guide range";

  return (
    <div className="wz-wrap wz-reveal wz-reveal--v2" data-testid="reveal" data-estimate-id={estimateId}>
      <div className="wz-rv-hero">
        <section className="wz-rv-card" aria-labelledby="reveal-kicker">
          <p className="wz-rv-label">
            <span className="wz-kick" id="reveal-kicker" data-testid="reveal-kicker">{kicker}</span>
            <span className="wz-rv-pill">Guide · within {payload.bandPct}%</span>
          </p>
          {/* C11 — the roller reveal: the one motion moment on this screen (S3 keeps it rather
              than adding a count-up — the run sheet allows one, not both), and none at all for
              anyone who asked their OS for less motion. */}
          <div className="wz-range" data-testid="reveal-range">
            <span className="wz-range-roll"><span>{fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}</span></span>
          </div>
          <p className="wz-range-note">Includes GST. Excludes access equipment and structural repairs.</p>
          {/* C8 (⚑25): a "both" job — inside and outside, each its own range; the figure above is the two together. */}
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
          {/* C12 — the commercial note: a guide range with a person confirming, never a price to fix online. */}
          {payload.commercial && (
            <p className="wz-reveal-flag wz-rv-cnote" data-testid="reveal-commercial-note" data-widen={payload.commercial.widenPct}>
              A guide range for a commercial job — one of our estimators confirms it before any price is fixed.
              {commercial && openCount(commercial.segment, commercial.answers) > 0 && payload.commercial.photos === 0
                ? " A photo of the open area narrows it straight away."
                : ""}
            </p>
          )}
          <p className="wz-restate" data-testid="reveal-restatement">{basis}</p>

          {/* Guide → Detailed → Confirmed, drawn as bars of decreasing width. An explanation, not a
              control: "the only progression the customer sees is the range narrowing and three
              honest words" (Ruling G). Never points, never a badge. */}
          <div className="wz-tiers wz-ladder" data-testid="reveal-tiers" aria-label="How the range narrows">
            <div className="wz-ladder-row now">
              <p><span className="on">Guide</span><em>where you are now</em></p>
              <i aria-hidden="true"><b style={{ width: `${guideBar}%` }} /></i>
            </div>
            <div className="wz-ladder-row">
              <p><span>Detailed</span><em>after checking it {how.split(",")[0]}</em></p>
              <i aria-hidden="true"><b style={{ width: "34%" }} /></i>
            </div>
            {insideOnly ? (
              <div className="wz-ladder-row">
                <p><span>Confirmed</span><em>fixed with your estimator</em></p>
                <i aria-hidden="true"><b style={{ width: "6%" }} /></i>
              </div>
            ) : (
              <p className="wz-ladder-visit" data-testid="reveal-tiers-visit">
                <b>Then a visit.</b> {payload.commercial ? "Every commercial price" : "Every outside price"} is confirmed on site by your estimator before it&rsquo;s fixed.
              </p>
            )}
          </div>
        </section>

        <div className="wz-rv-doors">
          <h2 className="wz-doors-head">Where would you like to go from here?</h2>
          <div className="wz-doors">
            <Door
              testId="door-tighten" icon="◫" title="Tighten my price" onClick={onTighten}
              body={`Get a more accurate quote now. A few minutes, ${how}.`}
              hero
            />
            {speakWithUs && onSpeak && (
              <Door
                testId="door-speak" icon="☎" title="Speak with us" onClick={onSpeak}
                body="Request a call to finalise your booking"
              />
            )}
            <Door
              testId="door-book" icon="📍" title="Book a site visit" onClick={onBook}
              body="Choose a time for us to see the property"
            />
            {onMessage && (
              <Door
                testId="door-message" icon="✉" title="Send us a message" onClick={onMessage}
                body="Ask a question about your estimate"
              />
            )}
            {kept ? (
              <p className="wz-kept" data-testid="reveal-kept">
                {kept.emailed
                  ? <>Saved, and the link is on its way to <b>{email.trim()}</b>. It opens straight to this price.</>
                  : <>Saved to <b>{email.trim()}</b>. The email is taking its time — you can carry on here, and it&rsquo;ll be waiting in your account.</>}
              </p>
            ) : contactKnown ? null : !keepOpen ? (
              <Door
                testId="door-keep" icon="✉" title="Keep this estimate" onClick={() => setKeepOpen(true)}
                body={`We'll email a link so you can pick it up any time. The price is held for ${payload.holdDays ?? 60} days.`}
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
        </div>
      </div>

      {/* C11 (v2.4) — the person is in the screen: who confirms this price, and the ways to
          reach them. Never an invented name. S3: the one dark strip on a customer screen. */}
      <div className="wz-rv-sign">
        <EstimatorStrip
          estimator={payload.estimator}
          suburb={null}
          companyPhone={phone}
          bookHref={`/estimate/visit?id=${estimateId}`}
        />
      </div>

      {/* The estimator has not seen this yet, and the customer should hear that from us. */}
      {payload.walkthroughRequired && (
        <p className="wz-reveal-flag" data-testid="reveal-flag">
          One of our estimators will look this over before any price is fixed.
        </p>
      )}
      {/* Tom, 15 Sep: "needs work" is priced with the extra-prep allowance, and the areas themselves are a person's call. */}
      {quick.jobType !== "exterior" && quick.condition === "needs_work" && (
        <p className="wz-reveal-flag" data-testid="reveal-prep-check">
          Any areas that need extra preparation are checked by our estimator before they&rsquo;re priced.
        </p>
      )}

      <div className={`wz-rv-cards ${UI_FLAGS.similarJobCard ? "three" : ""}`}>
        <section className="wz-rv-c">
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
          {openAssumed ? (
            <ul className="wz-assumed" data-testid="reveal-assumed">
              {assumptions.map((a) => (
                <li key={a.key} data-testid={`reveal-assumed-${a.key}`}>
                  <b>{a.what}</b>
                  <span>{a.why}</span>
                  {/* 14 Sep: the range is an envelope over the open questions — say which of these still hold it open. */}
                  {OPEN_BY_KEY[a.key]?.some((q) => (payload.openQuestions ?? []).includes(q)) && (
                    <span className="wz-assumed-open" data-testid={`reveal-open-${a.key}`}>Still open — answering it narrows the range</span>
                  )}
                  {/* C10: each line deep-links to the card that changes it. */}
                  {a.rung && (
                    <a className="wz-linkish" href={`/estimate/scope?id=${estimateId}#${a.rung}`} data-testid={`reveal-assumed-link-${a.key}`}>Change this</a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wz-rv-c-note">Answering the open ones narrows your range. Tap to see them.</p>
          )}
        </section>
        {/* ⚑ 2 / ⚑ 14: "A job like yours" is OFF until Tom rules — the row is two cards wide. */}
        <section className="wz-rv-c" data-testid="reveal-trust">
          <h3>Why {payload.commercial ? "businesses" : "people"} choose us</h3>
          <ul className="wz-rv-proof">
            {trust?.rating != null && trust.count != null && trust.count > 0 && (
              <li><b>{trust.rating.toFixed(1)} from {trust.count} Google review{trust.count === 1 ? "" : "s"}</b>
                {trust.url ? <a href={trust.url} target="_blank" rel="noopener noreferrer">Read them before you decide</a> : <small>Read them before you decide</small>}</li>
            )}
            {payload.commercial
              ? <li><b>Certificates and SWMS with every quote</b><small>Insurance and safe work method statements attached</small></li>
              : trust?.warranty ? <li><b>{trust.warranty}</b>{trust.warrantyNote && <small>{trust.warrantyNote}</small>}</li> : null}
          </ul>
        </section>
      </div>

      {/* C9 — the coats and prep the engine derived, in plain English, no controls. */}
      <WhatWeDo lines={payload.systems ?? []} tellUsHref={`/estimate/book?id=${estimateId}`} />

      {/* Phone: the one thing to do next stays in reach while they read (a second way in, not a second door). */}
      <div className="wz-rv-dock">
        <button type="button" className="wz-btn wz-bp wz-bpaint" onClick={onTighten} data-testid="reveal-dock-tighten">Tighten my price</button>
      </div>
    </div>
  );
}

function Door({ icon, title, body, onClick, testId, hero = false }: {
  icon: string; title: string; body: string; onClick: () => void; testId: string; hero?: boolean;
}) {
  return (
    <button type="button" className={`wz-door${hero ? " wz-door-hero" : ""}`} onClick={onClick} data-testid={testId} data-hero={hero ? "1" : undefined}>
      <span className="wz-door-icon" aria-hidden="true">{icon}</span>
      <span className="wz-door-text">
        <b>{title}</b>
        <span>{body}</span>
      </span>
      <span className="wz-door-go" aria-hidden="true">›</span>
    </button>
  );
}
