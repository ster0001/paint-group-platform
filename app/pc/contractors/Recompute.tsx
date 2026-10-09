"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recomputePainterStatusesAction } from "../actions";

/** Run the evaluator for every painter now — the daily sweep's pass, on demand. */
export default function Recompute() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="row" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn dim" disabled={pending} data-testid="status-recompute"
        onClick={() => start(async () => {
          setMsg(null);
          const r = await recomputePainterStatusesAction();
          setMsg(r.message ?? "Done.");
          if (r.ok) router.refresh();
        })}>
        {pending ? "Recomputing…" : "Recompute now"}
      </button>
      {msg && <span className="small" data-testid="status-recompute-msg" style={{ color: msg.includes("failed") ? "var(--amber)" : "var(--muted)" }}>{msg}</span>}
    </span>
  );
}
