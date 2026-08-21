import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadConsole } from "@/lib/workorder/consoleData";
import { buildQueue } from "@/lib/workorder/console";
import { STAGE_LANES, WO_STAGES } from "@/lib/workorder/stages";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

/**
 * The seven-lane pipeline. A card sits in the lane the model says it sits in —
 * there is nothing to drag and nothing to set, because the stage is earned at a
 * gate rather than chosen.
 */
export default async function FlowPage() {
  const supabase = await createClient();
  const { input } = await loadConsole(supabase);
  const queue = buildQueue(input);

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
        <h1>The flow, live.</h1>
        <p className="lede">
          Seven stages, every open job sitting where the model says it sits. A card
          moves only when its gate is true.
        </p>
      </div>

      <div className="sect">
        <div className="riverwrap">
          <div className="river" data-testid="river">
            {WO_STAGES.map((stage) => {
              const jobs = input.workOrders.filter((w) => w.stage === stage);
              const lane = STAGE_LANES[stage];
              return (
                <div className={`lane ${jobs.length > 0 ? "hot" : ""}`} key={stage} data-testid={`lane-${stage}`}>
                  <div className="lane-h">
                    <span className="n">{lane.n} {lane.title}</span>
                    <span className="bar" />
                    <span className="c">{jobs.length}</span>
                  </div>

                  {jobs.map((job) => {
                    const severity = worst.get(job.id);
                    return (
                      <Link className={`job ${severity === "critical" ? "crit" : severity === "warning" ? "warnb" : ""}`}
                        href={`/pc/wo/${job.id}`} key={job.id} data-testid={`job-${job.id}`}>
                        <span className="a">{job.title}</span>
                        <span className="r">
                          {job.woRef}{job.contractorName ? ` · ${job.contractorName}` : ""}
                        </span>
                        <span className="m">
                          {money(job.contractValueCents)}
                          {job.ticksTotal > 0 ? ` · ${job.ticksDone}/${job.ticksTotal} ticks` : ""}
                        </span>
                        <div className="fl">
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
          Swipe sideways. Amber = blocked on a decision · red = overdue. Both failure
          paths — a QA fail and a flag at walkthrough — pour back into 03.
        </p>
      </div>
    </>
  );
}
