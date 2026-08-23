"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { markCollectionHandled } from "./actions";

/**
 * The "Organised" press on a rubbish / equipment prompt (Tom, 23 Aug). The
 * card is the painter's yes from the finishing-up list; this clears it once
 * the office has booked the pickup. "Open" sits beside it for the detail.
 */
export default function CollectionDone({ itemId, cardKey, href }: { itemId: string; cardKey: string; href: string }) {
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) return <span className="pill" data-testid={`action-${cardKey}`}>organised</span>;

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }} data-testid={`action-${cardKey}`}>
      <Link className="btn" href={href}>Open</Link>
      <button type="button" className="btn primary" disabled={pending}
        data-testid={`collect-done-${itemId}`}
        onClick={() => startTransition(async () => {
          const r = await markCollectionHandled({ itemId });
          if (r.ok) setDone(true); else setMessage(r.message);
        })}>
        {pending ? "…" : "Organised"}
      </button>
      {message && <small style={{ color: "var(--amber)" }}>{message}</small>}
    </span>
  );
}
