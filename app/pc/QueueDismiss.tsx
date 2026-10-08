"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissWorkItem } from "@/app/crm/actions";

/** One dismissal button for a PC card — the queue's own crm_dismiss_work_item, with the reason on the log. */
export default function QueueDismiss({ itemKey, label, reason }: { itemKey: string; label: string; reason: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  if (gone) return <span className="pill p-em" data-testid={`dismissed-${itemKey}`}>Noted</span>;
  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <button type="button" className="btn dim" disabled={pending} data-testid={`dismiss-${itemKey}`}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await dismissWorkItem(itemKey, null, null, reason);
          if (r.ok) { setGone(true); router.refresh(); } else setMsg(r.message);
        })}>
        {pending ? "…" : label}
      </button>
      {msg && <span className="note" style={{ color: "var(--amber)" }}>{msg}</span>}
    </span>
  );
}
