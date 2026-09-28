"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissUpdatesForClosedJobs } from "../actions";

/**
 * Tom, 29 Sep 2026: drafts pile up on jobs that have since completed, and it
 * is too late to send any of them. One press clears every unsent draft on a
 * closed job; each removal is logged on its job. Shown only while there is
 * something to clear.
 */
export default function ClearClosed({ count }: { count: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (count === 0 && !message) return null;
  return (
    <div className="card" data-testid="clear-closed">
      <div className="row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <p className="note" style={{ margin: 0, flex: 1 }}>
          {message ?? `${count} draft${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} on jobs that have already completed — too late to send.`}
        </p>
        {count > 0 && !message && (
          <button type="button" className={`btn ${confirm ? "primary" : "dim"}`} disabled={pending} data-testid="clear-closed-go"
            onClick={() => {
              if (!confirm) { setConfirm(true); return; }
              startTransition(async () => {
                const r = await dismissUpdatesForClosedJobs();
                setMessage(r.message ?? null);
                if (r.ok) router.refresh();
              });
            }}>
            {pending ? "Deleting…" : confirm ? `Yes, delete ${count}` : "Delete them all"}
          </button>
        )}
      </div>
    </div>
  );
}
