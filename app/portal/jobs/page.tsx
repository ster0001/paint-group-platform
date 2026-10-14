import Link from "next/link";
import { requireContractor } from "@/lib/contractor/session";
import {
  listContractorJobs,
  groupJobs,
  JOB_STATUS_CHIP,
  money,
  shortDate,
  type ContractorJob,
} from "@/lib/contractor/jobs";
import { listEmployeeJobs } from "@/lib/contractor/employeeJobs";
import { listWorkerJobs } from "@/lib/contractor/workerJobs";
import { loadWorkers } from "@/lib/contractor/workers";
import { createClient } from "@/lib/supabase/server";
import WorkersCard from "@/app/portal/WorkersCard";
import FinishChip from "@/app/components/FinishChip";
import Placeholder from "../Placeholder";
import DemoControls from "@/app/components/demo/DemoControls";

export const dynamic = "force-dynamic";

function JobCard({ job }: { job: ContractorJob }) {
  // Employed painters (S3): the same card, with a time budget where a
  // contractor sees their price, and the Accept state on the chip row.
  const a = job.assignment;
  const chip = JOB_STATUS_CHIP[job.status] ?? { cls: "gry", label: job.status };
  const doc = job.doc;
  // Live, from wo_surfaces — the frozen document never leaves "not_started".
  const done = job.surfacesDone;
  const total = job.surfacesTotal;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", gap: 6 }}>
          <span className={`chip ${chip.cls}`}>{chip.label}</span>
          {job.isDemo && <span className="chip amb" data-testid="job-demo-chip">Demo</span>}
          {a && !a.acceptedAt && <span className="chip amb" data-testid="job-tap-accept">Tap Accept</span>}
          {a?.isLead && <span className="chip cyn">Lead</span>}
        </span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--muted)", letterSpacing: ".08em" }}>
          {job.woRef}
        </span>
      </div>

      <h2 style={{ marginTop: 8, fontSize: 14.5 }}>{doc?.jobTitle || "Painting works"}</h2>

      {doc?.finishCode && (
        <div style={{ margin: "8px 0 2px" }}>
          <FinishChip code={doc.finishCode} />
        </div>
      )}

      <div className="frow">
        <span className="l">Start</span>
        <span className="v">{shortDate(job.startDate)}</span>
      </div>
      {total > 0 && (
        <div className="frow">
          <span className="l">Progress</span>
          <span className="v">
            {done} OF {total} SURFACES
          </span>
        </div>
      )}
      {a ? (
        <div className="frow">
          <span className="l">Time budget</span>
          <span className="v">{a.timeBudget.days} DAY{a.timeBudget.days === 1 ? "" : "S"} · {a.timeBudget.hours.toFixed(1)} H</span>
        </div>
      ) : (
        <div className="frow">
          <span className="l">Your price</span>
          <span className="v cyan">{money(job.paymentCents)}</span>
        </div>
      )}

      <Link href={`/portal/jobs/${job.id}`} className="btn gh">
        Open work order
      </Link>
    </div>
  );
}

export default async function JobsPage() {
  const { contractor, capabilities } = await requireContractor();

  // One list, three loaders: a contractor's issued work orders, an
  // employee's assignments, or a worker's shared jobs — the last two through
  // money-free RPCs. Same shape every way.
  const jobs = capabilities.isWorker ? (await listWorkerJobs()).jobs
    : !contractor ? [] : capabilities.acceptsOffers
    ? await listContractorJobs(contractor.id)
    : await listEmployeeJobs();

  // The practice job (induction brief §4): its own heading, and a way to set it
  // up for a contractor who has none yet (ruling I4 — every contractor can
  // seed and reset their own). Employees get theirs with the worker induction.
  const { current, upcoming, previous, demo } = groupJobs(jobs);
  // The contractor's crew (Step 3a): add a worker, text their login, remove them. Sharing is per job.
  const crew = capabilities.hasCrewCount && contractor ? (await loadWorkers(await createClient(), contractor.id)).workers : null;
  const demoSection = capabilities.acceptsOffers && (
    <>
      <p className="slab" style={{ marginTop: 16 }} data-testid="jobs-demo-heading">Demo</p>
      {demo.length > 0 ? demo.map((j) => <JobCard key={j.id} job={j} />) : <DemoControls mode="start" />}
    </>
  );

  if (jobs.length === 0 && capabilities.isWorker) {
    return (
      <Placeholder
        title="Jobs"
        slab="The jobs your contractor shares with you"
        icon="▤"
        heading="Nothing shared yet"
        body="When your contractor shares a job with you it appears here with the scope, the finish standard and the tick list. You tick your work and add photos under your own name."
        soon="Waiting on your first job"
      />
    );
  }

  if (jobs.length === 0 && !demoSection) {
    return (
      <Placeholder
        title="Jobs"
        slab="Current · upcoming · previous"
        icon="▤"
        heading="No jobs yet"
        body="Every job Paint Group issues to you lands here with its work order — the full scope, finish level, colours and materials — so you know exactly what you're walking into."
        soon="Waiting on your first job"
      />
    );
  }

  return (
    <div className="wrap">
      <h1>Jobs</h1>
      <p className="slab">Current · upcoming · previous</p>
      {jobs.length === demo.length && (
        <p className="hint" style={{ marginTop: 10 }}>
          No jobs yet. Every job Paint Group issues to you lands here with its work order.
        </p>
      )}

      {current.length > 0 && (
        <>
          <p className="slab" style={{ marginTop: 16 }}>On the tools now</p>
          {current.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <p className="slab" style={{ marginTop: 16 }}>Coming up</p>
          {upcoming.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </>
      )}

      {previous.length > 0 && (
        <>
          <p className="slab" style={{ marginTop: 16 }}>Finished</p>
          {previous.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </>
      )}

      {demoSection}

      {crew && (
        <>
          <p className="slab" style={{ marginTop: 16 }}>Your crew</p>
          <WorkersCard mode="account" workers={crew} />
        </>
      )}
    </div>
  );
}
