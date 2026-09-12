"use client";

import WhatWeDo, { whatWeDoLines } from "@/app/wizard/WhatWeDo";
import EstimatorStrip from "@/app/wizard/EstimatorStrip";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  NOT_INCLUDED, finishOptions, summaryRows,
  type SummaryInput,
} from "@/lib/wizard/finish-line";
import { DEFAULT_HOLD_DAYS, holdWords } from "@/lib/wizard/confirmation-actions";
import ContactCard from "@/app/estimate/scope/ContactCard";

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

/**
 * "5 December 2026" — the date a held price runs to, said in full.
 *
 * `heldUntil` is a CALENDAR DATE (`YYYY-MM-DD`), already computed in
 * Melbourne's day by `holdUntil`. It carries no time and therefore no offset,
 * so it is read as UTC midnight and formatted in UTC: that hands back exactly
 * the date the server wrote. The first cut pinned it to `+10:00`, which is
 * only Melbourne for half the year — a 60-day hold taken in September lands in
 * November, inside daylight saving, and every such date rendered a day early.
 * The repo's own offset guard (`lib/workorder/boundary.test.ts`) caught it.
 */
const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : iso;
};

const capitaliseFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Finish({
  tier = "guide", estimator = null, suburb = null,
  estimateId, input, fixedPriceCents, companyPhone, phoneHours, customerPhone, busy = false, kind = "rooms",
  holdDays = DEFAULT_HOLD_DAYS,
}: {
  estimateId: string;
  /** C11 — the ladder's tier, from the bundle; the finish line never derives it. */
  tier?: "guide" | "detailed" | "confirmed";
  /** C11 — the resolved estimator for the strip, or null. */
  estimator?: { name: string | null; phone: string | null; covers: boolean } | null;
  suburb?: string | null;
  input: SummaryInput;
  /**
   * The single number a self-serve customer would be accepting — `null` for
   * every job that may not be fixed online, because the server does not send
   * the point price to those at all (see `CustomerPayload.centralCents`).
   * The fix door is not offered without it, so there is nothing to show.
   */
  fixedPriceCents: number | null;
  companyPhone: string | null;
  phoneHours: string | null;
  customerPhone: string | null;
  busy?: boolean;
  /** C4 — an exterior walk has no rooms; the copy follows (finishOptions). */
  kind?: "rooms" | "sides";
  /** C7 — Settings `wizard_hold_days`; the door's copy and the date agree. */
  holdDays?: number;
}) {
  const router = useRouter();
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  const [fixed, setFixed] = useState<{ priceCents: number; heldUntil: string } | null>(null);
  const [handedOver, setHandedOver] = useState(false);
  const { payload } = input;
  const rows = summaryRows(input);
  const options = finishOptions(payload, fixedPriceCents == null ? "" : fmt(fixedPriceCents), kind, holdWords(holdDays));

  async function choose(key: string) {
    if (sending || busy) return;
    /**
     * A visit opens the contact card HERE rather than bouncing back to the
     * editor's reach strip. They have just come from that screen; sending
     * them back to it to answer a question this screen asked is the kind of
     * round trip that makes people give up and ring instead.
     */
    if (key === "book_visit") { setContactOpen((v) => !v); return; }
    setSending(key);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `view` is what tells the route to answer with the CUSTOMER payload —
        // the same declaration every tap in the editor makes. C7: fixing the
        // price is its OWN action, carrying no figure — the server prices it
        // and the server's ladder decides whether it may be fixed at all.
        body: JSON.stringify({
          action: key === "fix_online" ? "fix_online" : "accept_intent",
          view: "customer",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "That didn't send — try again in a moment.");
        setSending(null);
        return;
      }
      /**
       * C7 — THE STALE CLIENT.
       *
       * This screen may have been sitting open while the job changed: a spot
       * flagged in another tab, a room added, the total pushed over the cap.
       * The door said "fix my price online" because that was true when the
       * page rendered; by the tap it may not be. The server has already done
       * the kind thing — made the confirmation request instead — so all this
       * has to do is say so, without an error and without blaming anyone.
       */
      const body = (await res.json().catch(() => ({}))) as {
        fixedOnline?: { priceCents: number; heldUntil: string };
        fixDeclined?: boolean;
      };
      if (body.fixedOnline) {
        setFixed(body.fixedOnline);
        setSending(null);
        return;
      }
      if (body.fixDeclined) {
        setHandedOver(true);
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

      {/* C11: the tier word comes from the ONE ladder (`tier`), never from a
          band number re-read here. */}
      <div className="wz-tiers" data-testid="finish-tiers" data-tier={tier}>
        <span className={tier === "guide" ? "on" : ""}>Guide</span>
        <span className={tier === "detailed" ? "on" : ""}>Detailed</span>
        <span className={tier === "confirmed" ? "on" : ""}>Confirmed</span>
      </div>

      <h2 className="wz-doors-head">Make it a fixed price</h2>
      {/**
        * C7 — once it IS a fixed price, the doors are gone.
        *
        * Leaving them up would invite a second tap on a decision that has
        * already been made and written down, and the idempotent answer to
        * that is still a worse experience than not asking twice.
        */}
      {fixed ? (
        <div className="wz-fixed" data-testid="finish-fixed">
          <b>Your price is fixed at {fmt(fixed.priceCents)} inc. GST.</b>
          <span>
            {capitaliseFirst(holdWords(holdDays))} — until {longDate(fixed.heldUntil)}. Nothing to pay now.
            We&rsquo;ve emailed it to you, and it&rsquo;s on your estimate whenever you want to look.
          </span>
          <a className="wz-linkish" href={`/estimate/sent?id=${estimateId}`}>See what happens next</a>
        </div>
      ) : handedOver ? (
        <div className="wz-fixed" data-testid="finish-handed-over">
          <b>One of our estimators is confirming this one.</b>
          <span>
            Something about the job changed while this page was open, so we&rsquo;d rather a person
            put their name to the number than have us guess. They have everything you&rsquo;ve
            given us — there&rsquo;s nothing else for you to do.
          </span>
          <a className="wz-linkish" href={`/estimate/sent?id=${estimateId}`}>See what happens next</a>
        </div>
      ) : (
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
      )}
      {error && <p className="wz-err" data-testid="finish-error">{error}</p>}

      {requested ? (
        <p className="wz-kept" data-testid="finish-requested">{requested}</p>
      ) : contactOpen && (
        <ContactCard
          companyPhone={companyPhone}
          phoneHours={phoneHours}
          defaultPhone={customerPhone}
          busy={busy}
          /**
           * AWAITED, and the promise comes after it lands — not before.
           *
           * The first cut fired this off and showed "we'll ring you" straight
           * away. That is a lie waiting to happen: a request that fails, or
           * one cut off because the customer closes the tab a second later,
           * leaves somebody certain they are getting a call that nobody was
           * ever told to make. The spinner is worth the honesty.
           */
          onSubmit={async (req) => {
            if (sending) return;
            setSending("contact");
            setError(null);
            try {
              const res = await fetch(`/api/estimates/${estimateId}/wizard-edit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "request_contact", ...req, view: "customer" }),
              });
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setError(j.error ?? "That didn't send — try again, or give us a ring.");
                return;
              }
              setContactOpen(false);
              setRequested(req.how === "visit"
                ? "Thanks — we'll ring you to lock in a visit time that suits. We're available Monday to Friday."
                : "Thanks — we'll call you back to finalise your price. We're available Monday to Friday.");
            } catch {
              setError("That didn't send — check your connection, or give us a ring.");
            } finally {
              setSending(null);
            }
          }}
        />
      )}

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

      {/* C9 — the same derived lines the reveal and the editor show, read-only. */}
      <WhatWeDo lines={whatWeDoLines(input.systems)} tellUsHref={`/estimate/scope?id=${estimateId}#reach`} />

      <p className="wz-notincluded" data-testid="finish-excluded">{NOT_INCLUDED}</p>

      {/* C11 — the person is in the screen, on the finish line too. */}
      <EstimatorStrip estimator={estimator} suburb={suburb} companyPhone={companyPhone} bookHref={`/estimate/scope?id=${estimateId}#reach`} />

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
