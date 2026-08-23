"use client";

import { useState, useTransition } from "react";
import { advanceStage, closeWithoutWalkthrough, confirmPrepStaff, deliverEvidencePack, reopenSignoff, startNow } from "../../actions";
import { STAGE_LANES, nextStages, type WoStage } from "@/lib/workorder/stages";

/**
 * Moving a job to its next stage — the control that was missing.
 *
 * The machine has always decided which moves exist and whether a job is ready;
 * there was simply nothing to press, so a job could reach pre-start and stop
 * there for ever. The buttons come from the transition table, so this screen can
 * never offer a move the database would refuse as illegal — only as not-yet-ready,
 * which it then explains in the gate's own words.
 */
export default function StageAdvance({
  workOrderId, stage, startDate, today, walkthroughRequired = true,
}: {
  workOrderId: string; stage: WoStage;
  /** The booked start date, so starting early can be recognised as such. */
  startDate: string | null;
  /** Today in Melbourne, computed on the server so the two agree. */
  today: string;
  /** False = "walkthrough not required" on the booking: prep/QA close the job. */
  walkthroughRequired?: boolean;
}) {
  const early = stage === "pre_start" && startDate !== null && startDate > today;
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [moved, setMoved] = useState<WoStage | null>(null);
  const [pending, startTransition] = useTransition();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  // Forward moves only: going back happens by a quality-check fail or a
  // customer's flag,
  // which are their own actions with their own consequences.
  const order = Object.keys(STAGE_LANES) as WoStage[];
  // Forward moves; and the two hand-over exits are mutually exclusive per job —
  // the pack when a walkthrough is required, straight to closed when it isn't.
  const moves = nextStages(stage, "staff")
    .filter((t) => order.indexOf(t.to) > order.indexOf(stage))
    .filter((t) => !(stage === "qa" && (t.to === "walkthrough" ? !walkthroughRequired : t.to === "closed" ? walkthroughRequired : false)));

  if (moved) {
    return (
      <div className="card" data-testid="stage-advance">
        <h3>Stage <em>moved</em></h3>
        <p className="note" data-testid="stage-moved">
          Now at {STAGE_LANES[moved].n} {STAGE_LANES[moved].title}. {message ?? ""}
        </p>
      </div>
    );
  }

  // Closed: the one way back is a deliberate staff reopen (Tom, 23 Aug) —
  // something picked up within days of signing. The customer signs again.
  if (stage === "closed") {
    return (
      <div className="card" data-testid="stage-advance">
        <h3>Next step <em>06 Closed — final invoice sent</em></h3>
        <p className="note">This job is finished and signed off.</p>
        {message && <p className="note" style={{ color: "var(--amber)" }} data-testid="stage-message">{message}</p>}
        {reopening ? (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <textarea className="edit" rows={2} value={reason} data-testid="reopen-reason"
              placeholder="What was found — e.g. customer rang, run in the hallway paint"
              onChange={(e) => setReason(e.target.value)} />
            <div className="row">
              <button type="button" className="btn primary" disabled={pending} data-testid="reopen-confirm"
                onClick={() => startTransition(async () => {
                  setMessage(null);
                  const r = await reopenSignoff({ workOrderId, reason: reason.trim() });
                  if (r.ok) { setMoved("walkthrough"); setMessage(r.message ?? null); setReopening(false); }
                  else setMessage(r.message);
                })}>
                {pending ? "Reopening…" : "Reopen — back to sign-off"}
              </button>
              <button type="button" className="btn" onClick={() => setReopening(false)}>Cancel</button>
            </div>
            <p className="note" style={{ margin: 0 }}>
              The sign-off is cleared and the customer looks again; the warranty keeps its original start.
            </p>
          </div>
        ) : (
          <button type="button" className="btn dim" style={{ marginTop: 8 }} data-testid="reopen-open"
            onClick={() => setReopening(true)}>
            Something found after sign-off — reopen
          </button>
        )}
      </div>
    );
  }

  if (moves.length === 0) {
    return (
      <div className="card" data-testid="stage-advance">
        <h3>Next step</h3>
        <p className="note">
          Nothing for the office to press here — this stage moves when the contractor or the customer acts.
        </p>
      </div>
    );
  }

  function go(to: WoStage) {
    setMessage(null);
    // Starting before the booked date is a decision, not a tap: it moves the
    // start date, and the silent-site catch starts watching from today.
    if (to === "in_progress" && early && !confirmEarly) { setConfirmEarly(true); return; }
    startTransition(async () => {
      // Prep -> walkthrough mints the customer's link and starts their clock.
      const result = to === "walkthrough"
        ? await deliverEvidencePack({ workOrderId })
        : to === "closed" && stage !== "walkthrough"
          ? await closeWithoutWalkthrough({ workOrderId })
          : to === "in_progress" && early
            ? await startNow({ workOrderId })
            : await advanceStage({ workOrderId, to });
      if (result.ok) { setMoved(to); setMessage(result.message ?? null); }
      else setMessage(result.message);
    });
  }

  return (
    <div className="card" data-testid="stage-advance">
      <h3>Next step <em>{STAGE_LANES[stage].n} {STAGE_LANES[stage].title}</em></h3>

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid="stage-message">{message}</p>}

      {confirmEarly && (
        <p className="note" style={{ color: "var(--amber)" }} data-testid="early-warning">
          This job isn&rsquo;t due to start until {new Date(`${startDate}T00:00:00`)
            .toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}.
          Starting now moves the start date to today, and the silent-site check
          begins watching it. Press again to go ahead.
        </p>
      )}

      {stage === "completion_prep" || stage === "in_progress" ? (
        <div className="row">
          {/* One routed step, same as the painter's: the server decides
              quality-check-or-pack. Two raw lane buttons here made the split
              look like a staff choice — it isn't (Tom, 23 Aug). */}
          <button type="button" className="btn primary" disabled={pending}
            data-testid="advance-confirm-prep"
            onClick={() => startTransition(async () => {
              setMessage(null);
              const r = await confirmPrepStaff({ workOrderId });
              if (r.ok && r.to) { setMoved(r.to); setMessage(r.message ?? null); }
              else setMessage(r.message ?? "That didn't work.");
            })}>
            {pending ? "Working…" : "All done — next step"}
          </button>
        </div>
      ) : (
      <div className="row">
        {moves.map((t) => (
          <button key={t.to} type="button" className="btn primary" disabled={pending}
            onClick={() => go(t.to)} data-testid={`advance-${t.to}`}>
            {pending ? "Working…" : t.to === "walkthrough" ? "Send the pack to the customer"
              : t.to === "closed" && stage !== "walkthrough" ? "Close the job — no walkthrough required"
              : t.to === "in_progress" ? "Start the job"
              : t.to === "qa" ? "Send to quality check"
              : t.to === "completion_prep" ? "Move to completion prep"
              : `Move to ${STAGE_LANES[t.to].title}`}
          </button>
        ))}
      </div>
      )}
      <p className="note">
        {stage === "pre_start" ? (early
            ? "Tick the list whenever you like — the job starts itself on its booked date."
            : "The pre-start list has to be true before a job can start.")
          : stage === "in_progress" ? "Every surface has to be ticked off first."
          : stage === "qa" ? (walkthroughRequired
              ? "Every scheduled check has to be logged as a pass."
              : "Every scheduled check has to be logged as a pass — then the job closes (no walkthrough on this booking).")
          : stage === "completion_prep" ? "The completion list has to be ticked before the customer is asked to look."
          : ""}
      </p>
    </div>
  );
}
