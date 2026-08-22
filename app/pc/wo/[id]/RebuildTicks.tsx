"use client";

import { useState, useTransition } from "react";
import { rebuildTickList } from "../../actions";

/**
 * A job with no tick list is a painter with nothing to tick and no way to say
 * so. Jobs issued before the list existed are in exactly that state, so the
 * office needs to be able to build one without a developer.
 */
export default function RebuildTicks({ workOrderId, empty }: { workOrderId: string; empty: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="row" style={{ marginTop: 10 }}>
      <button type="button" className={`btn ${empty ? "primary" : ""}`} disabled={pending}
        data-testid="rebuild-ticks"
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const r = await rebuildTickList({ workOrderId });
            setMessage(r.ok ? (r.message ?? "Done.") : r.message);
          });
        }}>
        {pending ? "Building…" : empty ? "Build the tick list" : "Refresh the tick list"}
      </button>
      {message && <span className="note" data-testid="rebuild-msg">{message}</span>}
    </div>
  );
}
