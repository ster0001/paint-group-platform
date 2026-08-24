"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitContractorInvoiceAction } from "../actions";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One tap, one confirmation — the server recomputes and pins everything. */
export default function SubmitInvoice({ id, totalIncCents, blocked }: {
  id: string; totalIncCents: number;
  /** A reason submitting is held (profile gap, pending deduction) — shown instead of the button. */
  blocked: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (blocked) {
    return <p className="hint" data-testid="submit-blocked">{blocked}</p>;
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await submitContractorInvoiceAction({ id });
      if (result.ok) router.refresh();
      else setMessage(result.message);
    });
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button type="button" className="btn cy" disabled={pending}
        onClick={submit} data-testid="submit-invoice">
        {pending ? "Submitting…" : `Submit invoice — ${money(totalIncCents)}`}
      </button>
      {message && <p className="hint" role="status" data-testid="submit-message">{message}</p>}
    </div>
  );
}
