"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVariationDeduction } from "../../actions";

/**
 * Ruling 3: a signed credit hit scope that was already started, so the pay
 * deduction routes HERE and a person sets it. The contractor sees the figure
 * on their job page (and again before their invoice submits) — informed, not
 * asked.
 */
export default function SetDeduction({
  id, startedSurfaces, creditCents,
}: { id: string; startedSurfaces: number | null; creditCents: number | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setMessage("Enter the deduction as a dollar figure (0 is allowed).");
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await setVariationDeduction({ variationId: id, amountDollars: dollars, note });
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="card" style={{ marginTop: 8, borderColor: "rgba(214,158,46,.5)" }} data-testid={`set-deduction-${id}`}>
      <h3>Pay adjustment <em>needs you</em></h3>
      <p className="note">
        The customer signed this removal, but work had already started
        {startedSurfaces ? ` on ${startedSurfaces} surface${startedSurfaces === 1 ? "" : "s"}` : ""} —
        deductions are never automatic. Set what comes off the contractor&rsquo;s pay
        {creditCents ? ` (the customer&rsquo;s credit is $${(creditCents / 100).toFixed(2)})` : ""}.
      </p>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input
          type="number" min="0" step="0.01" inputMode="decimal"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="Deduction $"
          data-testid={`deduction-amount-${id}`}
          style={{ width: 120 }}
        />
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Why this figure (the contractor sees it)"
          data-testid={`deduction-note-${id}`}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn primary" disabled={pending}
          onClick={submit} data-testid={`set-deduction-btn-${id}`}>
          {pending ? "Saving…" : "Set deduction"}
        </button>
      </div>
      {message && <p className="note" role="status">{message}</p>}
    </div>
  );
}
