import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadConsole } from "@/lib/workorder/consoleData";
import { buildQueue } from "@/lib/workorder/console";
import { LANES, LANE_LABELS, bySoonestStart, laneFor, startAlert, type WoStage } from "@/lib/workorder/stages";
import { melbourneDate } from "@/lib/workorder/console";
import { loadOpenCallbacks } from "@/lib/callbacks/load";
import { callbackLine } from "@/lib/callbacks/model";
import { reportError } from "@/lib/monitoring/report";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

/**
 * The seven-lane pipeline. A card sits in the lane the model says it sits in —
 * there is nothing to drag and nothing to set, because the stage is earned at a
 * gate rather than chosen.
 *
 * Booking confirmed (Tom, 1 Oct 2026) is the one lane that is not a stage: a
 * booked job waits there until its start date is within a week, then shows in
 * Pre-start. The split is `laneFor`, from the start date and today's date.
 */
export default async function FlowPage() {
  const supabase = await createClient();
  const { input } = await loadConsole(supabase);
  const queue = buildQueue(input);
  const today = melbourneDate(new Date());

  // Call backs (Step 3, ruling C9): a column that exists only while one is
  // open — not a stage, the machine is untouched — and a tag on the job card.
  // "Invoice chasing paused" rides the same cards from the hold the call back set.
  const openCallbacks = await loadOpenCallbacks(supabase);
  if (openCallbacks.error) reportError(new Error(openCallbacks.error), { where: "pc.flow.callbacks", bestEffort: true });
  const callbackJobIds = [...new Set(openCallbacks.callbacks.map((c) => c.workOrderId))];
  const pausedJobs = new Set<string>();
  if (callbackJobIds.length) {
    const { data: held, error: heldErr } = await supabase.from("invoices").select("work_order_id").eq("chase_hold_kind", "call_back").in("work_order_id", callbackJobIds);
    if (heldErr) reportError(heldErr, { where: "pc.flow.holds", bestEffort: true });
    for (const h of (held ?? []) as { work_order_id: string | null }[]) if (h.work_order_id) pausedJobs.add(h.work_order_id);
  }
  const jobById = new Map(input.workOrders.map((w) => [w.id, w]));
  const { data: closedRows, error: closedErr } = callbackJobIds.length
    ? await supabase.from("work_orders").select("id, wo_ref, wo_snapshot, contractors(company_name, profiles(name))").in("id", callbackJobIds)
    : { data: [], error: null };
  if (closedErr) reportError(closedErr, { where: "pc.flow.callbackJobs", bestEffort: true });
  const callbackJobs = ((closedRows ?? []) as unknown as { id: string; wo_ref: string; wo_snapshot: { jobTitle?: string; jobAddress?: string } | null; contractors: { company_name: string | null; profiles: { name: string | null } | null } | null }[])
    .map((w) => ({ id: w.id, woRef: w.wo_ref, title: w.wo_snapshot?.jobAddress || w.wo_snapshot?.jobTitle || w.wo_ref, painter: w.contractors?.profiles?.name || w.contractors?.company_name || "", callbacks: openCallbacks.callbacks.filter((c) => c.workOrderId === w.id), onBoard: jobById.has(w.id) }));

  const worst = new Map<string, "critical" | "warning">();
  for (const card of queue) {
    if (card.severity === "info") continue;
    const current = worst.get(card.workOrderId);
    if (current === "critical") continue;
    worst.set(card.workOrderId, card.severity);
  }

  return (
    <>
      <div>
        <h1>Project progress, live.</h1>
        <p className="lede">
          Seven lanes, every open job sitting where the model says it sits. A card
          moves only when its gate is true — or, into Pre-start, when its start
          date is within the week.
        </p>
      </div>

      <div className="sect">
        {callbackJobs.length > 0 && (
          <div className="lane hot callbacks" data-testid="lane-callbacks">
            <div className="lane-h">
              <span className="n" style={{ color: "var(--clay)" }}>Call backs</span>
              <span className="bar" />
              <span className="c">{openCallbacks.callbacks.length}</span>
            </div>
            {callbackJobs.map((job) => (
              <Link className="job crit" href={`/pc/wo/${job.id}#callbacks`} key={job.id} data-testid={`callback-job-${job.id}`}>
                <span className="a">{job.title}</span>
                <span className="r">{job.woRef}{job.painter ? ` · ${job.painter}` : ""}</span>
                <span className="m">{callbackLine(job.callbacks[0])}</span>
                <div className="fl">
                  <span className="pill p-clay">Call back</span>
                  {pausedJobs.has(job.id) && <span className="pill p-amber">Invoice chasing paused</span>}
                </div>
              </Link>
            ))}
            <p className="note">This column shows only while a call back is open. It is not a stage — the job stays where its gate put it.</p>
          </div>
        )}
        <div className="riverwrap">
          <div className="river" data-testid="river">
            {LANES.map((stage) => {
              const inLane = input.workOrders.filter((w) => laneFor(w.stage as WoStage, w.startDate, today) === stage);
              // Tom, 8 Oct 2026: Pre-start reads soonest start first, and a
              // job starting within three days is lit orange (startAlert).
              const jobs = stage === "pre_start" ? [...inLane].sort(bySoonestStart) : inLane;
              const lane = LANE_LABELS[stage];
              return (
                <div className={`lane ${jobs.length > 0 ? "hot" : ""}`} key={stage} data-testid={`lane-${stage}`}>
                  <div className="lane-h">
                    <span className="n">{lane.n} {lane.title}</span>
                    <span className="bar" />
                    <span className="c">{jobs.length}</span>
                  </div>

                  {jobs.map((job) => {
                    const severity = worst.get(job.id);
                    const alert = stage === "pre_start" ? startAlert(job.startDate, today) : null;
                    return (
                      <Link className={`job ${severity === "critical" ? "crit" : severity === "warning" ? "warnb" : ""}${alert ? " soon" : ""}`}
                        href={`/pc/wo/${job.id}`} key={job.id} data-testid={`job-${job.id}`}
                        data-soon={stage === "pre_start" ? String(alert !== null) : undefined}>
                        {alert && <span className="soon-l" data-testid={`soon-${job.id}`}>{alert}</span>}
                        <span className="a">{job.title}</span>
                        <span className="r">
                          {job.woRef}{job.contractorName ? ` · ${job.contractorName}` : ""}
                        </span>
                        <span className="m">
                          {money(job.contractValueCents)}
                          {job.ticksTotal > 0 ? ` · ${job.ticksDone}/${job.ticksTotal} ticks` : ""}
                        </span>
                        <div className="fl">
                          {callbackJobIds.includes(job.id) && <span className="pill p-clay" data-testid={`callback-tag-${job.id}`}>Call back</span>}
                          {pausedJobs.has(job.id) && <span className="pill p-amber">Invoice chasing paused</span>}
                          {job.blockedReason && <span className="pill p-clay">Blocked</span>}
                          {!job.coloursConfirmed && stage === "pre_start" && (
                            <span className="pill p-amber">Colours TBC</span>
                          )}
                          {severity === "warning" && <span className="pill p-amber">Waiting</span>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <p className="note">
          Swipe sideways. Amber = blocked on a decision · red = overdue · orange
          in Pre-start = starts within three days (soonest at the top). A booked job
          moves from 02 to 03 on its own once it is due to start within seven days.
          Both failure paths — a quality-check fail and a flag at walkthrough — pour
          back into 04.
        </p>
      </div>
    </>
  );
}
