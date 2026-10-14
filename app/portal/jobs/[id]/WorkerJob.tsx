import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import type { WorkerJob as WorkerJobModel } from "@/lib/contractor/workerJobs";
import type { SurfaceRow } from "@/lib/workorder/surfaces";
import { jobNeedsBeforePhotos } from "@/lib/workorder/surfaces";
import { loadStandards, smallJobHours as loadSmallJobHours } from "@/lib/standards/load";
import { expectationsFor } from "@/lib/standards/model";
import WhatWeExpect from "@/app/components/standards/WhatWeExpect";
import TickList from "@/app/components/wo/TickList";
import BatchUploader from "@/app/components/wo/BatchUploader";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";

/**
 * The WORKER shape of the job page (induction Step 3a, ruling 13): the scope
 * and the finish standard, the before photos, the tick list, more photos, and
 * the job sheet with no pay on it — composed from the same components the
 * contractor's page uses (never a second copy of any of them). What is not
 * here is the login's rule, not this file's: no offer, no price, no variation,
 * no invoice, no messages, no finish or walk-through — those belong to the
 * contractor. Ticks and photos land under the worker's own name (wo_events
 * actor = their login).
 */
export default async function WorkerJob({ job, from }: { job: WorkerJobModel; from?: string }) {
  const supabase = await createClient();
  const id = job.id;
  const [surfRes, photoRes, standardsLoad, smallJob] = await Promise.all([
    supabase.from("wo_surfaces")
      .select("id, heading, heading_meta, label, state, rectification, removed_from_scope, photos_optional")
      .eq("work_order_id", id).order("sort", { ascending: true }),
    supabase.from("wo_photos").select("area, kind").eq("work_order_id", id).in("kind", ["before", "completion"]),
    loadStandards(),
    loadSmallJobHours(supabase),
  ]);
  if (surfRes.error) reportError(surfRes.error, { where: "worker.job.surfaces", extra: { workOrderId: id } });
  if (photoRes.error) reportError(photoRes.error, { where: "worker.job.photos", bestEffort: true, extra: { workOrderId: id } });

  const surfaces: SurfaceRow[] = ((surfRes.data ?? []) as
    { id: string; heading: string; heading_meta: string; label: string; state: SurfaceRow["state"]; rectification: boolean; removed_from_scope: boolean; photos_optional?: boolean | null }[])
    .map((r) => ({ id: r.id, heading: r.heading, label: r.label, state: r.state, rectification: r.rectification, removed: r.removed_from_scope, photosOptional: Boolean(r.photos_optional) }));
  const headingMeta: Record<string, string> = {};
  for (const r of (surfRes.data ?? []) as { heading: string; heading_meta: string }[]) if (r.heading_meta) headingMeta[r.heading] = r.heading_meta;
  const hasBeforePhoto = ((photoRes.data ?? []) as { kind: string }[]).some((p) => p.kind === "before");
  const canTick = job.stage === "in_progress";
  const areas = [...new Set(surfaces.map((s) => s.heading))];
  const expectations = standardsLoad.standards && job.doc ? expectationsFor(standardsLoad.standards, job.doc, "portal", id) : [];

  return (
    <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }} data-testid="worker-job">
      <div style={{ padding: "0 16px" }}>
        <Link href={from === "home" ? "/portal" : "/portal/jobs"} className="backlink" data-testid="job-back">← Jobs</Link>
        <div className="card">
          <span className="chip gry">Shared by {job.contractorName}</span>
          <h2 style={{ marginTop: 8, fontSize: 15 }}>{job.doc?.jobTitle || job.woRef}</h2>
          <p className="hint" style={{ padding: 0, marginTop: 4 }}>
            {job.doc?.jobAddress}{job.doc?.finishCode ? ` · ${job.doc.finishCode}` : ""} · {job.surfacesDone} of {job.surfacesTotal} surfaces done
          </p>
          <p className="hint" style={{ padding: 0, marginTop: 6 }}>
            Tick your work as you do it and add photos. Questions, changes to the job and the money are your contractor&rsquo;s — ask them.
          </p>
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>
        <WhatWeExpect items={expectations} mode="portal" />
        {standardsLoad.error && <p className="hint" style={{ color: "var(--amber)" }}>The finish standards did not load — it has been reported.</p>}
      </div>

      {surfaces.length > 0 && (canTick ? (
        <div style={{ padding: "0 16px" }}>
          {jobNeedsBeforePhotos(surfaces, hasBeforePhoto) ? (
            <BatchUploader workOrderId={id} kind="before" testId="before"
              title="Before photos first"
              hint="Pick photos of each room or side as you found it. The app will not let anyone start an area without one."
              areas={areas} />
          ) : (
            <details className="card slim" data-testid="before-more">
              <summary>Before photos are in — add more</summary>
              <BatchUploader workOrderId={id} kind="before" testId="before-more" title="More before photos" hint="Only if a room or side was missed." areas={areas} />
            </details>
          )}
          <TickList surfaces={surfaces} hasBeforePhoto={hasBeforePhoto} headingMeta={headingMeta} />
          <BatchUploader workOrderId={id} kind="progress" testId="progress"
            title="Progress photos" hint="A photo at the end of each day is what the customer sees as progress." areas={areas} />
        </div>
      ) : (
        <div style={{ padding: "0 16px" }}>
          <div className="card" data-testid="worker-not-started">
            <b>{job.stage === "closed" ? "This job is finished." : "This job has not started yet."}</b>
            <p className="hint" style={{ padding: 0, marginTop: 4 }}>
              {job.stage === "closed" ? "Thank you — the list below is what was done." : "Your contractor starts it on the day; the tick list opens then. The scope and the standards are below."}
            </p>
          </div>
        </div>
      ))}

      {job.doc && (
        <WorkOrderDoc doc={job.doc} variant="crew" standardsBase="portal" smallJobHours={smallJob} />
      )}
    </div>
  );
}
