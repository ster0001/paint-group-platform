"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { loadClarity } from "@/lib/marketing/clarity";
import { consentCookie, parseConsent, type Consent } from "@/lib/marketing/consent";

/**
 * Tom's consent spec (4 Sep): a bottom sheet, two buttons — `Only what's
 * needed` (the default and the visually quieter one) and `Allow analytics` —
 * the choice stored in a first-party cookie for 12 months, and a "Cookie
 * settings" link in the footer that reopens it (it dispatches OPEN_EVENT).
 * Clarity loads only after "Allow analytics". The events table receives
 * events regardless (first-party).
 */
export const OPEN_EVENT = "pg:consent-open";

export default function ConsentSheet() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Consent | null>(null);
  const declineRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // The cookie is read after hydration (the server can't see it), on the
    // next tick so the first client render matches the server's.
    const t = window.setTimeout(() => {
      const choice = parseConsent(document.cookie);
      setCurrent(choice);
      if (choice === "analytics") loadClarity();
      if (!choice) setOpen(true);
    }, 0);
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.clearTimeout(t); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  useEffect(() => { if (open) declineRef.current?.focus(); }, [open]);

  function choose(choice: Consent) {
    document.cookie = consentCookie(choice, location.protocol === "https:");
    setCurrent(choice);
    setOpen(false);
    track("consent_choice", { choice });
    if (choice === "analytics") loadClarity();
    // "Only what's needed" after a previous "Allow": the tag is already on this
    // page; it is simply not loaded again on the next one. No PII was ever sent.
  }

  if (!open) return null;
  return (
    <div className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-h" data-testid="consent-sheet" data-current={current ?? "none"}>
      <div className="consent-body">
        <p id="consent-h" className="consent-t">Cookies</p>
        <p className="consent-p">
          We use a small first-party cookie so the site works. If you allow it, we also use Microsoft Clarity to see how the page is used — click maps and anonymous recordings — so we can make it clearer. Your address is never sent to Clarity.
        </p>
        <div className="consent-btns">
          <button ref={declineRef} type="button" className="btn btn-ghost" onClick={() => choose("essential")} data-testid="consent-decline">Only what&rsquo;s needed</button>
          <button type="button" className="btn btn-cyan" onClick={() => choose("analytics")} data-testid="consent-allow">Allow analytics</button>
        </div>
      </div>
    </div>
  );
}
