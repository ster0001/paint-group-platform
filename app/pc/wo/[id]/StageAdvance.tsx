"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceStage, closeWithoutWalkthrough, confirmPrepStaff, deliverEvidencePack, reopenSignoff, staffComplete, startNow, waiveAfterPhotos } from "../../actions";
import { LANE_LABELS, STAGE_LANES, laneFor, nextStages, type WoStage } from "@/lib/workorder/stages";
import BatchUploader from "@/app/components/wo/BatchUploader";

/**
 * What stands between an In-progress job and its next step, counted on the
 * server from the same rows the gates read — so the card can say it BEFORE
 * the press, in the order the office would fix it.
 */
export type Readiness = {
  /** Working rows not yet Done (struck rows excluded). */
  surfacesLeft: number;
  /** Working rows in total. */
  surfacesTotal: number;
  /** Rows done, rows that want photos, and no after photo on the job. */
  needsAfterPhotos: boolean;
  /** The office has waived the after photos on this job (migration 20270215). */
  afterPhotosWaived: boolean;
  /** Required finishing-up items still to tick or answer. */
  prepLeft: number;
  /** Variations raised, priced or customer-approved — not yet settled. */
  variationsWaiting: number;
  /** Area headings, for tagging an after-photo batch. */
  areas: string[];
};

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
  workOrderId, stage, startDate, today, walkthroughRequired = true, staffSignsOff = false, readiness = null,
}: {
  workOrderId: string; stage: WoStage;
  /** In progress only: what is left before the next step, said up front. */
  readiness?: Readiness | null;
  /** The booked start date, so starting early can be recognised as such. */
  startDate: string | null;
  /** Today in Melbourne, computed on the server so the two agree. */
  today: string;
  /** False = "walkthrough not required" on the booking: prep/QA close the job. */
  walkthroughRequired?: boolean;
  /**
   * True when a quality check passed on this job (Tom, 24 Sep 2026): the
   * OFFICE signs it off at 06 Walkthrough — the customer is not asked to.
   */
  staffSignsOff?: boolean;
}) {
  const early = stage === "pre_start" && startDate !== null && startDate > today;
  // Header wording follows the lane: a job booked weeks out reads
  // "02 Booking confirmed", not "03 Pre-start" (Tom, 1 Oct 2026).
  const here = LANE_LABELS[laneFor(stage, startDate, today)];
  const [confirmEarly, setConfirmEarly] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [moved, setMoved] = useState<WoStage | null>(null);
  const [pending, startTransition] = useTransition();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [waiving, setWaiving] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");
  const [waived, setWaived] = useState(readiness?.afterPhotosWaived ?? false);
  const router = useRouter();
  // The rest of the page (ticks, checklist, QA cards, the rail) is server
  // rendered; after a move it re-reads so the whole screen agrees with this card.
  const moveTo = (to: WoStage, note: string | null) => { setMoved(to); setMessage(note); router.refresh(); };

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
          Now at {LANE_LABELS[laneFor(moved, startDate, today)].n} {LANE_LABELS[laneFor(moved, startDate, today)].title}. {message ?? ""}
        </p>
      </div>
    );
  }

  // Closed: the one way back is a deliberate staff reopen (Tom, 23 Aug) —
  // something picked up within days of signing. The customer signs again.
  if (stage === "closed") {
    return (
      <div className="card" data-testid="stage-advance">
        <h3>Next step <em>07 Closed — final invoice sent</em></h3>
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
                  if (r.ok) { moveTo("walkthrough", r.message ?? null); setReopening(false); }
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
      // From the walkthrough stage, "closed" is one of three things: the
      // no-walkthrough close (flag off — Tom, 24 Sep: even once the job is
      // already here), the office's sign-off after a quality check, or the
      // plain move. Each writes the record a signing would.
      const result = to === "walkthrough"
        ? await deliverEvidencePack({ workOrderId })
        : to === "closed" && !walkthroughRequired
          ? await closeWithoutWalkthrough({ workOrderId })
          : to === "closed" && stage === "walkthrough" && staffSignsOff
            ? await staffComplete({ workOrderId, note: "" })
          : to === "in_progress" && early
            ? await startNow({ workOrderId })
            : await advanceStage({ workOrderId, to });
      if (result.ok) moveTo(to, result.message ?? null);
      else setMessage(result.message);
    });
  }

  return (
    <div className="card" data-testid="stage-advance">
      <h3>Next step <em>{here.n} {here.title}</em></h3>

      {message && <p className="note" style={{ color: "var(--amber)" }} data-testid="stage-message">{message}</p>}

      {confirmEarly && (
        <p className="note" style={{ color: "var(--amber)" }} data-testid="early-warning">
          This job isn&rsquo;t due to start until {new Date(`${startDate}T00:00:00`)
            .toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}.
          Starting now moves the start date to today, and the silent-site check
          begins watching it. Press again to go ahead.
        </p>
      )}

      {readiness && (stage === "completion_prep" || stage === "in_progress") && (() => {
        const needsPhotos = readiness.needsAfterPhotos && !waived;
        const items: { key: string; done: boolean; text: string }[] = [
          { key: "surfaces", done: readiness.surfacesLeft === 0 && readiness.surfacesTotal > 0,
            text: readiness.surfacesTotal === 0 ? "No tick list on this job yet — build it from the job sheet"
              : readiness.surfacesLeft === 0 ? `Every surface ticked off (${readiness.surfacesTotal})`
              : `${readiness.surfacesLeft} of ${readiness.surfacesTotal} surfaces still to tick off` },
          { key: "after-photos", done: !needsPhotos && readiness.surfacesLeft === 0,
            text: waived ? "After photos waived by the office"
              : readiness.surfacesLeft > 0 ? "After photos — the painter's Step 3, once the ticks are done"
              : needsPhotos ? "After photos of all rooms or all sides — not in yet"
              : "After photos in" },
          { key: "prep", done: readiness.prepLeft === 0,
            text: readiness.prepLeft === 0 ? "Finishing-up list answered"
              : `${readiness.prepLeft} finishing-up item${readiness.prepLeft === 1 ? "" : "s"} to tick or answer` },
          ...(readiness.variationsWaiting > 0 ? [{ key: "variations", done: false,
            text: `${readiness.variationsWaiting} variation${readiness.variationsWaiting === 1 ? "" : "s"} still waiting on a decision` }] : []),
        ];
        return (
          <div data-testid="readiness" style={{ marginBottom: 10 }}>
            <p className="note" style={{ margin: "0 0 4px" }}>Before the next step:</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {items.map((i) => (
                <li key={i.key} data-testid={`readiness-${i.key}`} data-done={i.done ? "1" : "0"}
                  style={{ display: "flex", gap: 8, alignItems: "baseline", color: i.done ? "var(--em, inherit)" : "var(--amber)" }}>
                  <span aria-hidden="true">{i.done ? "✓" : "○"}</span>
                  <span>{i.text}</span>
                </li>
              ))}
            </ul>
            {needsPhotos && readiness.surfacesLeft === 0 && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }} data-testid="after-photos-routes">
                <BatchUploader workOrderId={workOrderId} kind="completion" testId="console-after"
                  title="Upload the after photos" buttonLabel="Upload after photos"
                  hint="If the painter has sent them to you — all rooms or all sides. The job can move on the moment they land."
                  areas={readiness.areas} />
                {waiving ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <textarea className="edit" rows={2} value={waiveReason} data-testid="waive-after-photos-reason"
                      placeholder="Why — e.g. painter texted the finished shots, filed on the estimate"
                      onChange={(e) => setWaiveReason(e.target.value)} />
                    <div className="row">
                      <button type="button" className="btn primary" disabled={pending} data-testid="waive-after-photos-confirm"
                        onClick={() => startTransition(async () => {
                          setMessage(null);
                          const r = await waiveAfterPhotos({ workOrderId, reason: waiveReason.trim() });
                          setMessage(r.message ?? null);
                          if (r.ok) { setWaived(true); setWaiving(false); router.refresh(); }
                        })}>
                        {pending ? "Saving…" : "Move on without after photos"}
                      </button>
                      <button type="button" className="btn" onClick={() => setWaiving(false)}>Cancel</button>
                    </div>
                    <p className="note" style={{ margin: 0 }}>Goes on the job&rsquo;s record with your name. The painter&rsquo;s own rule is unchanged.</p>
                  </div>
                ) : (
                  <button type="button" className="btn dim" data-testid="waive-after-photos-open" onClick={() => setWaiving(true)}>
                    No after photos coming — move on without them
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

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
              if (r.ok && r.to) moveTo(r.to, r.message ?? null);
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
              : t.to === "closed" && !walkthroughRequired ? "Close the job — no walkthrough required"
              : t.to === "closed" && stage === "walkthrough" && staffSignsOff ? "Sign off as complete — quality check passed"
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
          : stage === "in_progress" ? "One press: the server sends the job to a quality check if one is due, otherwise to the customer's walkthrough. Anything still in the way is said here in words."
          : stage === "qa" ? (walkthroughRequired
              ? "Every scheduled check has to be logged as a pass."
              : "Every scheduled check has to be logged as a pass — then the job closes (no walkthrough on this booking).")
          : stage === "completion_prep" ? "The completion list has to be ticked before the customer is asked to look."
          : stage === "walkthrough" && !walkthroughRequired ? "No walkthrough on this booking — closing writes the report, starts the warranty and drafts the invoice."
          : stage === "walkthrough" && staffSignsOff ? "The quality check passed, so the office signs this one off — the customer isn't asked to sign. They receive the completion report."
          : ""}
      </p>
    </div>
  );
}
