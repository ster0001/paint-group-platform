"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nudgeQuietSite } from "./actions";

/** Tom, 12 Nov 2026: "Nothing ticked in N days" — one press texts the crew to
 *  update their work order and closes the card off. */
export default function NudgeCrew({ workOrderId, primary }: { workOrderId: string; primary?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <span className="dmsg" data-testid={`nudged-${workOrderId}`}>{message}</span>;
  return (
    <>
      {message && <span className="dmsg" role="alert" style={{ fontSize: 12, color: "var(--clay, #C8553D)" }}>{message}</span>}
      <button
        type="button"
        className={`btn ${primary ? "primary" : ""}`}
        disabled={pending}
        data-testid={`nudge-crew-${workOrderId}`}
        onClick={() =>
          start(async () => {
            const r = await nudgeQuietSite({ workOrderId });
            setMessage(r.message ?? null);
            if (r.ok) {
              setDone(true);
              router.refresh();
            }
          })
        }
      >
        {pending ? "Texting…" : "Text the crew"}
      </button>
    </>
  );
}
