"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissWorkItem } from "@/app/crm/actions";

/**
 * A check-in card's two outcomes (Tom, 6 Oct 2026: check-ins are worked from
 * PC Command, not the CRM). Both are the one queue's own dismissal — the same
 * crm_dismiss_work_item that Today uses — so a call made here is a call made
 * everywhere, and the reason is on the dismissal log as always.
 *
 *   Rang them  — for good: the moment has been covered.
 *   Tomorrow   — one day: nobody picked up, try again.
 */
export default function CheckinDone({ itemKey, accountId }: { itemKey: string; accountId: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();

  const dismiss = (days: number | null, reason: string) => start(async () => {
    setMessage(null);
    const r = await dismissWorkItem(itemKey, accountId, days, reason);
    if (r.ok) { setGone(true); router.refresh(); }
    else setMessage(r.message);
  });

  if (gone) return <span className="pill p-em" data-testid={`checkin-done-${itemKey}`}>Noted</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <button type="button" className="btn primary" disabled={pending} data-testid={`checkin-rang-${itemKey}`}
        onClick={() => dismiss(null, "Rang them — check-in done from PC Command")}>
        {pending ? "…" : "Rang them"}
      </button>
      <button type="button" className="btn dim" disabled={pending} data-testid={`checkin-later-${itemKey}`}
        onClick={() => dismiss(1, "No answer — try again tomorrow (PC Command)")}>
        Tomorrow
      </button>
      {message && <span className="note" style={{ color: "var(--amber)" }}>{message}</span>}
    </span>
  );
}
