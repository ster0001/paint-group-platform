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
import FinishChip from "@/app/components/FinishChip";
import Placeholder from "../Placeholder";

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

  // One list, two loaders: a contractor's issued work orders, or an
  // employee's assignments through the money-free RPC. Same shape either way.
  const jobs = !contractor ? [] : capabilities.acceptsOffers
    ? await listContractorJobs(contractor.id)
    : await listEmployeeJobs();

  if (jobs.length === 0) {
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

  const { current, upcoming, previous } = groupJobs(jobs);

  return (
    <div className="wrap">
      <h1>Jobs</h1>
      <p className="slab">Current · upcoming · previous</p>

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
    </div>
  );
}
