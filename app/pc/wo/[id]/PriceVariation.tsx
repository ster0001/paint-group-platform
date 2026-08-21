"use client";

import { useState, useTransition } from "react";
import { priceVariationAction } from "@/app/quote/variationActions";
import { releaseVariation } from "../../actions";
import { contractorDeltaCents } from "@/lib/workorder/variations";
import type { VariationStatus } from "@/lib/workorder/variations";

const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 });

/**
 * Pricing a variation, from the console. Hours go up; money comes back.
 *
 * The estimate shown while typing is a PREVIEW of what the server will work out
 * — the real figure is computed there, through lib/pricing for the customer's
 * side and in SQL from the settings rate for the contractor's.
 */
export default function PriceVariation({
  id, status, released, estHours, priceCents, deltaCents,
}: {
  id: string; status: VariationStatus; released: boolean;
  estHours: number | null; priceCents: number | null; deltaCents: number | null;
}) {
  const [hours, setHours] = useState(estHours ? String(estHours) : "");
  const [materials, setMaterials] = useState("");
  const [state, setState] = useState<VariationStatus>(status);
  const [isReleased, setIsReleased] = useState(released);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Preview only — 6000 is the shipped rate; the server reads Settings.
  const preview = contractorDeltaCents(Number(hours) || 0, 6000);

  function price() {
    setMessage(null);
    startTransition(async () => {
      const result = await priceVariationAction({
        variationId: id,
        hours: Number(hours),
        materialsCents: Math.round((Number(materials) || 0) * 100),
      });
      if (result.ok) { setState("priced"); setMessage("Priced — the customer has it now."); }
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

  return (
    <>
      {message && <p className="note" data-testid={`variation-msg-${id}`}>{message}</p>}

      {state === "raised" && (
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

      {state === "priced" && (
        <p className="note" data-testid={`awaiting-${id}`}>
          {priceCents ? `${money(priceCents)} with the customer.` : "With the customer."} Waiting on their answer.
        </p>
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
