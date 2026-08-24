"use client";

import { useState, useTransition } from "react";
import SignaturePad from "@/app/components/SignaturePad";
import { respondToVariationAction, signVariationAction } from "./actions";

const money = (c: number) =>
  "$" + (Math.abs(c) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateFmt = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/**
 * Approving now means SIGNING (Tom's ruling, 24 Aug 2026): the approve button
 * opens a name field and the shared drawn-signature pad. Declining stays the
 * one-tap it always was — nobody signs to say no.
 */
export default function VariationDecision({
  token, priceCents, credit, status, signedName, signedAt,
}: {
  token: string; priceCents: number; credit: boolean; status: string;
  signedName: string | null; signedAt: string | null;
}) {
  const [state, setState] = useState(status);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "sign" | "decline">("none");
  const [doneName, setDoneName] = useState(signedName);
  const [doneAt, setDoneAt] = useState(signedAt);
  const [pending, startTransition] = useTransition();

  if (state === "customer_approved" || state === "contractor_accepted") {
    return (
      <div className="cv-done approved" data-testid="variation-outcome">
        <b>Approved — thank you.</b>
        <p>
          {credit
            ? `We'll take that out of the scope, and the ${money(priceCents)} comes off your final invoice.`
            : `We'll get straight on with it. The extra ${money(priceCents)} will appear on your final invoice.`}
        </p>
        {doneName && (
          <p className="cv-signedby" data-testid="variation-signedby">
            Signed by {doneName}
            {doneAt ? ` on ${dateFmt(doneAt)}` : ""}.
          </p>
        )}
      </div>
    );
  }
  if (state === "declined") {
    return (
      <div className="cv-done declined" data-testid="variation-outcome">
        <b>Declined.</b>
        <p>No problem — we&rsquo;ll leave that as it is and carry on with the rest of the job.</p>
      </div>
    );
  }

  function decline() {
    setMessage(null);
    startTransition(async () => {
      const result = await respondToVariationAction({ token, approve: false, note });
      if (result.ok) setState("declined");
      else setMessage(result.message);
    });
  }

  function sign() {
    setMessage(null);
    if (!name.trim()) { setMessage("Please enter your full name."); return; }
    if (!signature) { setMessage("Please sign in the box to approve."); return; }
    startTransition(async () => {
      const result = await signVariationAction({ token, name: name.trim(), signature });
      if (result.ok) {
        setDoneName(name.trim());
        setDoneAt(new Date().toISOString());
        setState("customer_approved");
      } else setMessage(result.message);
    });
  }

  return (
    <div className="cv-actions">
      {message && <p className="cv-msg" role="status" data-testid="variation-message">{message}</p>}

      {panel === "decline" ? (
        <>
          <label className="cv-label" htmlFor="why">
            Anything you&rsquo;d like us to know? (optional)
          </label>
          <textarea
            id="why" className="cv-note" rows={3} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Leave it for now, we'll look at it later…"
          />
          <button type="button" className="cv-btn ghost" disabled={pending}
            onClick={decline} data-testid="confirm-decline">
            {pending ? "Sending…" : "Confirm — don't do this work"}
          </button>
          <button type="button" className="cv-btn link" onClick={() => setPanel("none")}>
            Back
          </button>
        </>
      ) : panel === "sign" ? (
        <>
          <label className="cv-label" htmlFor="signname">Full name</label>
          <input
            id="signname" className="cv-note" value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name" data-testid="sign-name"
          />
          <span className="cv-label">Sign below</span>
          <SignaturePad onChange={setSignature} />
          {/* ⚑1 (addendum §4): wording drafted in-session, flagged for the same
              legal review batch as the deposit-cap / deemed-sign-off clauses. */}
          <p className="cv-fine">
            By signing, I approve this variation to my accepted quote and agree the
            contract price changes by {(credit ? "−" : "") + money(priceCents)} incl. GST.
            This approval forms part of my contract, and I confirm I&rsquo;m authorised
            to make it.
          </p>
          <button type="button" className="cv-btn primary" disabled={pending}
            onClick={sign} data-testid="confirm-sign">
            {pending ? "Sending…" : `Sign and approve ${(credit ? "−" : "") + money(priceCents)}`}
          </button>
          <button type="button" className="cv-btn link" onClick={() => setPanel("none")}>
            Back
          </button>
        </>
      ) : (
        <>
          <button type="button" className="cv-btn primary" disabled={pending}
            onClick={() => setPanel("sign")} data-testid="approve-variation">
            {`Approve ${(credit ? "−" : "") + money(priceCents)}`}
          </button>
          <button type="button" className="cv-btn ghost" disabled={pending}
            onClick={() => setPanel("decline")} data-testid="decline-variation">
            No thanks
          </button>
          <p className="cv-fine">
            {credit
              ? "Nothing to pay — approving takes this off your final invoice."
              : "Nothing is charged until the work is done, and it appears on your final invoice."}
          </p>
        </>
      )}
    </div>
  );
}
