"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetDemoAction, seedDemoAction } from "./demoActions";

/**
 * 12 Demo Street — the one component for the practice job's banner and its
 * buttons, with a `mode` for each surface (never two diverging copies):
 *
 *   portal  the contractor's own job page: a banner over the job + "Reset demo"
 *   pc      the office's view of the same job: the banner + reset for THIS contractor
 *   staff   the contractor's record: "Set up" or "Reset", Tailwind classes
 *   start   the Jobs tab when no demo exists yet: one "Start the practice job" card
 *
 * Reset is a real delete + re-seed (one transaction, migration 20270262), so
 * it asks once. After either action the page is refreshed and, for a new seed
 * from the Jobs tab, the painter is taken to the job.
 */
export default function DemoControls({
  mode, contractorId = null, hasDemo = true,
}: {
  mode: "portal" | "pc" | "staff" | "start";
  /** Staff name the contractor; a contractor acts on their own (null). */
  contractorId?: string | null;
  hasDemo?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const btn = mode === "staff"
    ? "rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    : "btn gh";

  async function run(kind: "seed" | "reset") {
    if (kind === "reset" && !window.confirm("Reset the practice job? Everything done in 12 Demo Street goes back to the start.")) return;
    setBusy(true); setMessage(null);
    const r = kind === "seed" ? await seedDemoAction({ contractorId }) : await resetDemoAction({ contractorId });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    if (mode === "start" || mode === "portal") { router.push(`/portal/jobs/${r.workOrderId}`); router.refresh(); return; }
    setMessage(kind === "seed" ? (r.existed ? "Already set up." : "Practice job set up.") : "Reset — back to the start.");
    router.refresh();
  }

  if (mode === "staff") {
    return (
      <span className="inline-flex items-center gap-2" data-testid="demo-controls">
        <span className="text-sm text-gray-900">{hasDemo ? "12 Demo Street is on their account" : "Not set up"}</span>
        <button type="button" className={btn} disabled={busy} onClick={() => run(hasDemo ? "reset" : "seed")}
          data-testid={hasDemo ? "demo-reset" : "demo-seed"}>
          {busy ? "Working…" : hasDemo ? "Reset demo" : "Set up demo"}
        </button>
        {message && <span className="text-xs text-gray-500" role="status">{message}</span>}
      </span>
    );
  }

  if (mode === "start") {
    return (
      <div className="card" data-testid="demo-start">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="chip gry">Demo</span>
          <b>12 Demo Street</b>
        </div>
        <p className="hint" style={{ padding: 0, marginTop: 6 }}>
          A practice job for the induction. Same screens as a real job, nothing in it is real,
          and nothing you do in it counts.
        </p>
        {message && <p className="tick-msg" role="status">{message}</p>}
        <button type="button" className={btn} disabled={busy} onClick={() => run("seed")} data-testid="demo-seed">
          {busy ? "Setting up…" : "Start the practice job"}
        </button>
      </div>
    );
  }

  return (
    <div className="card amberish" data-testid="demo-banner" style={{ marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="chip amb">Demo</span>
          <b>Practice job — nothing here is real</b>
        </span>
        <button type="button" className={btn} disabled={busy} onClick={() => run("reset")} data-testid="demo-reset">
          {busy ? "Resetting…" : "Reset demo"}
        </button>
      </div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {mode === "pc"
          ? "The painter's induction demo. It is left out of every count, queue and payment. Reset puts it back to the start for them."
          : "Make your mistakes here, not on a customer's job. Reset puts it back to the start."}
      </p>
      {message && <p className="tick-msg" role="status" data-testid="demo-message">{message}</p>}
    </div>
  );
}
