"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { bonusHandOverAction } from "@/app/(app)/contractors/actions";

/** "Tell Tom" (brief §8): marks the review handed over. The owner was notified when the card appeared; this records that the PC has seen it. */
export default function BonusHandover({ bonusId, painterId, itemKey, href }: { bonusId: string; painterId: string; itemKey: string; href: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <span className="pill p-em" data-testid={`bonus-handed-${itemKey}`}>With Tom</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <button type="button" className="btn primary" disabled={pending} data-testid={`bonus-tell-tom-${itemKey}`}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await bonusHandOverAction({ bonusId, painterId });
          if (r.ok) { setDone(true); router.refresh(); } else setMsg(r.message);
        })}>
        {pending ? "…" : "Tell Tom"}
      </button>
      <Link className="btn dim" href={href} data-testid={`bonus-open-${itemKey}`}>Open painter</Link>
      {msg && <span className="note" style={{ color: "var(--amber)" }}>{msg}</span>}
    </span>
  );
}
