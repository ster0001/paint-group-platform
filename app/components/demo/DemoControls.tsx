"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetDemoAction, seedDemoAction, sendDemoPromptAction } from "./demoActions";
import type { DemoChecklistRow } from "@/lib/demo/checklist";

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
  mode, contractorId = null, hasDemo = true, workOrderId = null, steps = null, inductionHref = null,
}: {
  mode: "portal" | "pc" | "staff" | "start";
  /** Staff name the contractor; a contractor acts on their own (null). */
  contractorId?: string | null;
  hasDemo?: boolean;
  /** The practice job (pc mode): the facilitator's Send demo prompt needs it. */
  workOrderId?: string | null;
  /** The demo checklist (Step 2) — derived from the job's rows, shown under the banner. */
  steps?: DemoChecklistRow[] | null;
  /**
   * Portal mode only (Tom, 16 Oct 2026): the painter switches to the practice
   * job to follow a module's "On your phone" steps, then needs an obvious way
   * back — the induction's next unticked module, or the list once all are.
   * Never on a real job; never for the office.
   */
  inductionHref?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function prompt() {
    if (!workOrderId) return;
    if (!window.confirm("Send the DEMO text to this painter's phone now? It is the one real text of the induction.")) return;
    setBusy(true); setMessage(null);
    const r = await sendDemoPromptAction({ workOrderId });
    setBusy(false);
    setMessage(r.ok ? `DEMO text ${r.outcome}.` : r.message);
    router.refresh();
  }

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
        <span style={{ display: "flex", gap: 8 }}>
          {mode === "pc" && workOrderId && (
            <button type="button" className={btn} disabled={busy} onClick={() => void prompt()} data-testid="demo-prompt">
              {busy ? "Working…" : "Send demo prompt"}
            </button>
          )}
          <button type="button" className={btn} disabled={busy} onClick={() => run("reset")} data-testid="demo-reset">
            {busy ? "Resetting…" : "Reset demo"}
          </button>
        </span>
      </div>
      <p className="hint" style={{ padding: 0, marginTop: 6 }}>
        {mode === "pc"
          ? "The painter's induction demo. It is left out of every count, queue and payment. Reset puts it back to the start for them; Send demo prompt is Module 6's one real text."
          : "Make your mistakes here, not on a customer's job. Reset puts it back to the start."}
      </p>
      {message && <p className="tick-msg" role="status" data-testid="demo-message">{message}</p>}
      {mode === "portal" && inductionHref && (
        <Link href={inductionHref} className="btn cy" style={{ marginTop: 10 }} data-testid="demo-back-induction">
          ← Back to the induction
        </Link>
      )}
      {steps && steps.length > 0 && (
        <ul className="clean" data-testid="demo-checklist" style={{ marginTop: 8, display: "grid", gap: 4, paddingLeft: 0, listStyle: "none" }}>
          {steps.map((s) => (
            <li key={s.key} data-testid={`demo-step-${s.key}`} data-done={s.done}
              style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, color: s.done ? "var(--text)" : "var(--muted)" }}>
              <span aria-hidden style={{ color: s.done ? "var(--emerald)" : "var(--muted)", fontFamily: "var(--mono)" }}>{s.done ? "✓" : "·"}</span>
              <span>{s.label}<span style={{ color: "var(--muted)" }}> — {s.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
