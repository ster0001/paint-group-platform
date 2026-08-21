"use client";

import { useState, useTransition } from "react";
import { requestExtensionAction, signAction, walkthroughAreaAction } from "./actions";

type AreaState = { approved?: boolean; flagged?: boolean; note?: string };

/**
 * The customer walks their own job, area by area, then signs.
 *
 * Flagging is deliberately as easy as approving. If the only easy button is
 * "happy", the flag that should have been raised turns into a phone call three
 * weeks later, and by then the painter has gone.
 */
export default function Walkthrough({
  token, headings, initial, signedName,
}: { token: string; headings: string[]; initial: Record<string, AreaState>; signedName: string | null }) {
  const [areas, setAreas] = useState<Record<string, AreaState>>(initial);
  const [signed, setSigned] = useState<string | null>(signedName);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  if (signed) {
    return (
      <div className="cv-done approved" data-testid="signed">
        <b>Signed off — thank you, {signed}.</b>
        <p>
          Your completion report and two-year warranty are on their way. If anything
          comes up later, that warranty still covers you.
        </p>
      </div>
    );
  }

  const outstanding = headings.filter((h) => !areas[h]?.approved);

  function respond(area: string, approve: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await walkthroughAreaAction({ token, area, approve, note: approve ? "" : note });
      if (!result.ok) { setMessage(result.message); return; }
      setAreas((a) => ({ ...a, [area]: approve ? { approved: true } : { flagged: true, note } }));
      setFlagging(null);
      setNote("");
      if (!approve) setMessage("Thanks — we've sent that back to the painter and we'll be in touch.");
    });
  }

  function sign() {
    setMessage(null);
    startTransition(async () => {
      const result = await signAction({ token, name });
      if (result.ok) setSigned(name);
      else setMessage(result.message);
    });
  }

  return (
    <div className="cv-actions">
      {message && <p className="cv-msg" role="status" data-testid="walkthrough-message">{message}</p>}

      {headings.map((heading) => {
        const state = areas[heading];
        return (
          <div className="wt-area" key={heading} data-testid={`area-${heading}`}>
            <div className="wt-area-top">
              <b>{heading}</b>
              {state?.approved && <span className="chip grn" data-testid={`ok-${heading}`}>Happy</span>}
              {state?.flagged && <span className="chip amb" data-testid={`flagged-${heading}`}>Flagged</span>}
            </div>

            {state?.flagged && flagging !== heading && (
              <p className="cv-fine" data-testid={`flag-note-${heading}`}>
                You told us: &ldquo;{state.note}&rdquo; — once the painter has been
                back, have another look and let us know.
              </p>
            )}

            {/* A flagged area comes back round: after the painter has fixed it the
                customer has to be able to approve it, or the job can never close. */}
            {!state?.approved && flagging !== heading && (
              <div className="wt-row">
                <button type="button" className="cv-btn primary" disabled={pending}
                  onClick={() => respond(heading, true)} data-testid={`approve-${heading}`}>
                  Happy with this
                </button>
                <button type="button" className="cv-btn ghost" disabled={pending}
                  onClick={() => setFlagging(heading)} data-testid={`flag-${heading}`}>
                  Something&rsquo;s not right
                </button>
              </div>
            )}

            {flagging === heading && (
              <div className="wt-flag">
                <label className="cv-label" htmlFor={`note-${heading}`}>What have you spotted?</label>
                <textarea id={`note-${heading}`} className="cv-note" rows={3} value={note}
                  onChange={(e) => setNote(e.target.value)}
                  data-testid={`note-${heading}`}
                  placeholder="A missed patch, a run in the paint, anything at all…" />
                <button type="button" className="cv-btn ghost" disabled={pending}
                  onClick={() => respond(heading, false)} data-testid={`send-flag-${heading}`}>
                  Send this back to the painter
                </button>
                <button type="button" className="cv-btn link" onClick={() => { setFlagging(null); setNote(""); }}>
                  Back
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="wt-sign">
        <label className="cv-label" htmlFor="sign-name">
          {outstanding.length === 0
            ? "Type your full name to sign off"
            : `Still to look at: ${outstanding.join(", ")}`}
        </label>
        <input id="sign-name" className="cv-note" value={name} data-testid="sign-name"
          onChange={(e) => setName(e.target.value)} placeholder="Your full name"
          disabled={outstanding.length > 0} />
        <button type="button" className="cv-btn primary" data-testid="sign"
          disabled={pending || outstanding.length > 0 || name.trim().length < 2}
          onClick={sign}>
          {pending ? "Signing…" : "Sign off the job"}
        </button>
        <p className="cv-fine">
          Signing confirms the work is done. Your two-year warranty starts today and
          nothing you find later stops being covered.
        </p>
      </div>

      <details className="wt-away">
        <summary>I&rsquo;m away at the moment</summary>
        <p className="cv-fine">Tell us when you&rsquo;re back and we&rsquo;ll hold it for you.</p>
        <input type="date" className="cv-note" data-testid="extension-date"
          onChange={(e) => {
            const until = e.target.value;
            if (!until) return;
            startTransition(async () => {
              const r = await requestExtensionAction({ token, until });
              setMessage(r.ok ? "No problem — we'll hold it and check back then." : (r.message ?? ""));
            });
          }} />
      </details>
    </div>
  );
}
