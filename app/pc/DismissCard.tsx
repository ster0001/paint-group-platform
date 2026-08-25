"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissCard } from "./actions";

/** Tom (25 Aug): the little ✕ that closes off an actioned card — permanent
 *  per card, recorded as an event, never a UI-only hide. */
export default function DismissCard({ workOrderId, cardKey }: {
  workOrderId: string;
  cardKey: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);

  if (gone) return null;
  return (
    <button
      type="button"
      aria-label="Close this card off — it's been actioned"
      title="Close this card off — it's been actioned"
      data-testid={`dismiss-${cardKey}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await dismissCard({ workOrderId, cardKey });
          if (r.ok) {
            setGone(true);
            router.refresh();
          }
        })
      }
      style={{
        appearance: "none", border: "none", background: "transparent",
        color: "var(--muted, #8C959D)", cursor: "pointer", fontSize: 14,
        lineHeight: 1, padding: "4px 6px", alignSelf: "flex-start",
      }}
    >
      ✕
    </button>
  );
}
