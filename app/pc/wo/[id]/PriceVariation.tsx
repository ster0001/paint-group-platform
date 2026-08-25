"use client";

import { useState, useTransition } from "react";
import { priceVariationAction } from "@/app/quote/variationActions";
import { sendVariationForSignatureAction } from "@/app/quote/revisionActions";
import { releaseVariation } from "../../actions";
import { contractorDeltaCents } from "@/lib/workorder/variations";
import type { VariationStatus } from "@/lib/workorder/variations";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 });

/**
 * Pricing a variation, from the console.
 *
 * Tom's ruling (25 Aug): the PRIMARY path is the revision builder — the
 * working scope is where a change is measured and engine-priced properly.
 * The hours-only quick price stays as the secondary path for a simple
 * labour add. Once priced, the signing link goes out from RIGHT HERE —
 * email, text or both, same as the builder offers.
 */
export default function PriceVariation({
  id, estimateId, status, released, estHours, priceCents, deltaCents, rateCents,
}: {
  id: string; estimateId: string; status: VariationStatus; released: boolean;
  estHours: number | null; priceCents: number | null; deltaCents: number | null;
  /** Read from Settings by the server component — never hardcoded here. */
  rateCents: number;
}) {
  const [hours, setHours] = useState(estHours ? String(estHours) : "");
  const [materials, setMaterials] = useState("");
  const [state, setState] = useState<VariationStatus>(status);
  const [isReleased, setIsReleased] = useState(released);
  const [message, setMessage] = useState<string | null>(null);
  const [quick, setQuick] = useState(false);
  const [pending, startTransition] = useTransition();

  // A preview of what the server will work out, using the same rate it will
  // use. Hardcoding $60 here would quietly lie the moment Settings changed.
  const preview = contractorDeltaCents(Number(hours) || 0, rateCents);

  function price() {
    setMessage(null);
    startTransition(async () => {
      const result = await priceVariationAction({
        variationId: id,
        hours: Number(hours),
        materialsCents: Math.round((Number(materials) || 0) * 100),
      });
      if (result.ok) { setState("priced"); setMessage("Priced — the signing link has been emailed. Text it too below if you like."); }
      else setMessage(result.message);
    });
  }

  function release() {
    setMessage(null);
    startTransition(async () => {
      const result = await releaseVariation({ variationId: id });
      if (result.ok) { setIsReleased(true); setMessage(result.message ?? "Released."); }
      else setMessage(result.message);
    });
  }

  function sendLink(via: "email" | "sms" | "both") {
    setMessage(null);
    startTransition(async () => {
      const r = await sendVariationForSignatureAction({ variationId: id, via });
      if (!r.ok) { setMessage(r.message ?? "Couldn't send the link."); return; }
      const bits: string[] = [];
      if (r.email?.status === "sent") bits.push("emailed");
      if (r.sms?.status === "sent") bits.push("texted");
      setMessage(bits.length ? `Signing link ${bits.join(" and ")}.` : "Nothing went out — check the contact's details.");
    });
  }

  return (
    <>
      {message && <p className="note" data-testid={`variation-msg-${id}`}>{message}</p>}

      {state === "raised" && (
        <>
          {/* The proper path: measure and price it in the working scope. */}
          <div className="row">
            <a className="btn primary" href={`/quote?id=${estimateId}&mode=revision`}
              data-testid={`price-in-builder-${id}`}>
              Price it in the builder — working scope
            </a>
            <button type="button" className="btn" onClick={() => setQuick((q) => !q)}
              data-testid={`quick-price-toggle-${id}`}>
              {quick ? "Hide quick price" : "Quick price — hours only"}
            </button>
          </div>
          {quick && (
            <>
              <label className="fld">
                Hours
                <input className="num" inputMode="decimal" value={hours} data-testid={`hours-${id}`}
                  onChange={(e) => setHours(e.target.value)} />
                Materials $
                <input className="num" inputMode="decimal" value={materials} data-testid={`materials-${id}`}
                  onChange={(e) => setMaterials(e.target.value)} />
              </label>
              {Number(hours) > 0 && (
                <p className="note" data-testid={`preview-${id}`}>
                  The contractor&rsquo;s side would be {money(preview)} — worked out on the server from the Settings rate.
                </p>
              )}
              <div className="row">
                <button type="button" className="btn primary" disabled={pending || !(Number(hours) > 0)}
                  onClick={price} data-testid={`price-${id}`}>
                  {pending ? "Pricing…" : "Price through the engine"}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {state === "priced" && (
        <>
          <p className="note" data-testid={`awaiting-${id}`}>
            {priceCents ? `${money(priceCents)} with the customer.` : "With the customer."} Waiting on their answer.
          </p>
          {/* The signing link, resendable on any channel (Tom, 25 Aug —
              same choices the builder offers). */}
          <div className="row">
            <button type="button" className="btn" disabled={pending} onClick={() => sendLink("email")} data-testid={`send-email-${id}`}>Email the link</button>
            <button type="button" className="btn" disabled={pending} onClick={() => sendLink("sms")} data-testid={`send-sms-${id}`}>Text the link</button>
            <button type="button" className="btn" disabled={pending} onClick={() => sendLink("both")} data-testid={`send-both-${id}`}>Both</button>
          </div>
        </>
      )}

      {state === "customer_approved" && !isReleased && (
        <div className="row">
          <button type="button" className="btn primary" disabled={pending}
            onClick={release} data-testid={`release-${id}`}>
            {pending ? "Releasing…" : `Release ${deltaCents ? money(deltaCents) : ""} to the contractor`}
          </button>
        </div>
      )}

      {state === "customer_approved" && isReleased && (
        <p className="note">Released — waiting on the contractor to accept.</p>
      )}

      {state === "contractor_accepted" && deltaCents != null && (
        <p className="note" data-testid={`accepted-${id}`}>
          Accepted. {money(deltaCents)} added to the contractor&rsquo;s payment.
        </p>
      )}
    </>
  );
}
