"use client";

import { useState, useTransition } from "react";
import { remindStandardsAction } from "@/app/(app)/contractors/actions";

/** The "Standards not signed" card's one action (brief §8): send the reminder text now. The card clears when they confirm. */
export default function StandardsRemind({ contractorId, itemKey }: { contractorId: string; itemKey: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  if (sent) return <span className="pill p-em" data-testid={`standards-reminded-${itemKey}`}>Text sent</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <button type="button" className="btn primary" disabled={pending} data-testid={`standards-remind-${itemKey}`}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await remindStandardsAction({ id: contractorId });
          if (r.ok) setSent(true); else setMsg(r.message);
        })}>
        {pending ? "…" : "Send reminder text"}
      </button>
      {msg && <span className="note" style={{ color: "var(--amber)" }}>{msg}</span>}
    </span>
  );
}
