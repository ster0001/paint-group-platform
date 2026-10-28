"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { CustomerPayload } from "@/lib/wizard/view";
import { restatement, type QuickLook } from "@/lib/wizard/quick-look";
import { exteriorRestatement, type ExteriorQuickLook } from "@/lib/wizard/exterior-quick-look";
import { initialsOf } from "@/lib/wizard/estimator";
import { PAINT_HOME_WORDS, type WizardBrand } from "@/lib/wizard/brand";
import { breakpointNow, sendWizardEvent } from "@/lib/wizard/wizardEvents";

/**
 * Wizard mobile v5, session 4 (brief §4) — THE GATE on a phone. Single
 * column, no picture (R5), in this order:
 *
 *   1. "Tom, your range today" → the range (Martian Mono, 40px) → the basis
 *      line → the small print (R3 — the one sentence, grey; no tolerance
 *      promise anywhere, R2).
 *   2. "Want the exact number?" · one line · the teal Get my exact price
 *      (D11) with "Room by room · about 10 min" · "Or book a time with
 *      <estimator> first".
 *   3. Three tiles (R4): Your range ✓ · Your exact price · <estimator> confirms.
 *   4. The estimator line. 5. The trust line (+ "Reviews powered by Paint
 *      Group" in 11px on Paint Home, R10). 6. "What's in the range",
 *      collapsed: the ticked surfaces with their coats.
 *
 * §4.1 the sticky bar holds Get my exact price only. §4.2 the "bigger job"
 * variant — a Paint Home job over the phone-close ceiling (the 27 Oct
 * hand-off) — replaces block 2 with "We'll come and look" + Book a visit,
 * never both, and the bar follows. "Book a time" opens the talk sheet
 * until session 5's Contact sheet. Events (§8): `gate_viewed` once on
 * screen, `gate_cta_clicked` for each door. Desktop keeps Reveal.
 */
const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;

export default function MobileGate({ payload, quick, outside, brand, estimateId, firstName, suburb, trust, handoff, onExact, onVisit, onBook }: {
  payload: CustomerPayload;
  quick: QuickLook;
  outside: ExteriorQuickLook | null;
  brand: WizardBrand;
  estimateId: string;
  firstName: string | null;
  suburb: string | null;
  trust: { rating: number | null; count: number | null; warranty: string | null } | null;
  /** §4.2: the bigger-job variant (Paint Home over the ceiling, or a job that needs seeing). */
  handoff: boolean;
  /** Get my exact price — the room-by-room editor (WizardApp decides the details sheet first). */
  onExact: () => void;
  /** "Book a time first" — the talk sheet for now (session 5: the Contact sheet at the slots). */
  onVisit: () => void;
  /** The bigger-job door: Book a visit. */
  onBook: () => void;
}) {
  useEffect(() => {
    sendWizardEvent("gate_viewed", { range_low: payload.rangeLoCents, range_high: payload.rangeHiCents, bigger_job: handoff, breakpoint: breakpointNow() });
  }, [estimateId, payload.rangeLoCents, payload.rangeHiCents, handoff]);
  const fire = (cta: "exact" | "visit") => sendWizardEvent("gate_cta_clicked", { cta, breakpoint: breakpointNow() });
  const exact = () => { fire("exact"); onExact(); };
  const visit = () => { fire("visit"); onVisit(); };
  const book = () => { fire("visit"); onBook(); };

  const [openIncluded, setOpenIncluded] = useState(false);
  const estimator = payload.estimator?.name?.trim() || null;
  const estFirst = estimator?.split(/\s+/)[0] ?? null;
  const who = estFirst ?? "Your estimator";
  const customer = firstName?.trim().split(/\s+/)[0] || "";
  const exteriorOnly = quick.jobType === "exterior" && outside != null;
  const basis = exteriorOnly ? exteriorRestatement(outside) : restatement(quick);
  const how = exteriorOnly ? "side by side" : "room by room";
  const painthome = brand === "painthome";
  const included = (payload.systems ?? []).filter((l) => l.coats > 0);
  const trustBits = [
    trust?.rating != null && trust.count != null && trust.count > 0 ? `${trust.rating.toFixed(1)} · ${trust.count} Google review${trust.count === 1 ? "" : "s"}` : null,
    trust?.warranty?.trim() || null,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="wzm wzm-gate" data-testid="wzm-gate" data-estimate-id={estimateId} data-variant={handoff ? "bigger" : "exact"}>
      <main className="wzm-main has-bar">
        {/* 1 · the range */}
        <section data-testid="gate-block-range">
          <p className="wzm-gate-label" data-testid="gate-label">{customer ? `${customer}, your range today` : "Your range today"}</p>
          <p className="wzm-gate-price" data-testid="gate-range">{fmt(payload.rangeLoCents)} – {fmt(payload.rangeHiCents)}</p>
          <p className="wzm-gate-basis" data-testid="gate-basis">{basis}</p>
          <p className="wzm-gate-fine" data-testid="gate-fine">Based on what you&rsquo;ve told us — anything different on the day changes the price. {who} confirms it with you before anything is fixed. Includes GST.</p>
        </section>

        {/* 2 · the one question — or, over the ceiling, the one door (§4.2, never both) */}
        {handoff ? (
          <section data-testid="gate-block-bigger">
            <h2 className="wzm-gate-ask">We&rsquo;ll come and look</h2>
            <p className="wzm-gate-asksub">{PAINT_HOME_WORDS.handoff.heading} {PAINT_HOME_WORDS.handoff.body}</p>
            <button type="button" className="wzm-cta wzm-cta--teal" onClick={book} data-testid="gate-book">Book a visit<small>About 40 minutes, no charge</small></button>
          </section>
        ) : (
          <section data-testid="gate-block-ask">
            <h2 className="wzm-gate-ask">Want the exact number?</h2>
            <p className="wzm-gate-asksub">
              Ten minutes, {how}, nothing to measure. {painthome ? `Then one short call with ${who} runs through the finer details and confirms it.` : `Then ${who} visits to run through the finer details and confirm it.`}
            </p>
            <button type="button" className="wzm-cta wzm-cta--teal" onClick={exact} data-testid="gate-exact">Get my exact price<small>{exteriorOnly ? "Side by side" : "Room by room"} · about 10 min</small></button>
            <p className="wzm-gate-alt">Or <button type="button" className="wzm-linkish" onClick={visit} data-testid="gate-visit">book a time with {who} first</button></p>
          </section>
        )}

        {/* 3 · the three tiles (R4) */}
        <ol className="wzm-tiles" data-testid="gate-tiles" data-at={handoff ? 2 : 1}>
          <Tile k="✓" state="done" title="Your range" sub="Just now" />
          <Tile k="2" state={handoff ? "todo" : "now"} title="Your exact price" sub="Online, today" />
          <Tile k="3" state={handoff ? "now" : "todo"} title={`${who} confirms`} sub={painthome && !handoff ? "On one short call" : "In person, 40 min"} />
        </ol>

        {/* 4 · the person */}
        <div className="wzm-gate-who" data-testid="gate-estimator" data-named={estimator ? "1" : "0"}>
          <span className="wzm-av" aria-hidden="true">{estimator ? initialsOf(estimator) : painthome ? "PH" : "PG"}</span>
          <div>
            <b>{estimator ? `${estimator}, your estimator` : "Your estimator"}</b>
            {payload.estimator?.covers && suburb?.trim() ? `Looks after ${suburb.trim()}. Ask anything.` : "Confirms your price before anything is fixed."}
          </div>
        </div>

        {/* 5 · trust */}
        {trustBits.length > 0 && (
          <p className="wzm-gate-trust" data-testid="gate-trust">
            {trustBits.join(" · ")}
            {painthome && trust?.count != null && trust.count > 0 && <><br /><span className="wzm-gate-powered" data-testid="gate-powered">Reviews powered by Paint Group</span></>}
          </p>
        )}

        {/* 6 · what's in the range */}
        {included.length > 0 && (
          <details className="wzm-gate-incl" data-testid="gate-included" open={openIncluded} onToggle={(e) => setOpenIncluded((e.target as HTMLDetailsElement).open)}>
            <summary>What&rsquo;s in the range</summary>
            <ul>
              {included.map((l, i) => (
                <li key={`${l.group}-${i}`} data-testid={`gate-included-${l.group}`} data-coats={l.coats}>
                  {l.title}<span>{l.coats} coat{l.coats === 1 ? "" : "s"}{l.undercoat ? " + undercoat" : ""}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>

      {/* §4.1 — the sticky bar: the one door only */}
      <div className="wzm-foot" data-testid="gate-bar">
        {handoff
          ? <button type="button" className="wzm-cta wzm-cta--teal" onClick={book} data-testid="gate-bar-book">Book a visit</button>
          : <button type="button" className="wzm-cta wzm-cta--teal" onClick={exact} data-testid="gate-bar-exact">Get my exact price</button>}
      </div>
    </div>
  );
}

function Tile({ k, state, title, sub }: { k: ReactNode; state: "done" | "now" | "todo"; title: string; sub: string }) {
  return (
    <li className={`wzm-tile ${state}`} data-state={state}>
      <span className="k" aria-hidden="true">{k}</span>
      <b>{title}</b>{sub}
    </li>
  );
}
