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
import FinishChip from "@/app/components/FinishChip";
import Placeholder from "../Placeholder";

export const dynamic = "force-dynamic";

function JobCard({ job }: { job: ContractorJob }) {
  const chip = JOB_STATUS_CHIP[job.status] ?? { cls: "gry", label: job.status };
  const doc = job.doc;
  const done = doc ? doc.areas.flatMap((a) => a.surfaces).filter((s) => s.status === "complete").length : 0;
  const total = doc ? doc.areas.flatMap((a) => a.surfaces).length : 0;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span className={`chip ${chip.cls}`}>{chip.label}</span>
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
      <div className="frow">
        <span className="l">Your price</span>
        <span className="v cyan">{money(job.paymentCents)}</span>
      </div>

      <Link href={`/portal/jobs/${job.id}`} className="btn gh">
        Open work order
      </Link>
    </div>
  );
}

export default async function JobsPage() {
  const { contractor } = await requireContractor();

  const jobs = contractor ? await listContractorJobs(contractor.id) : [];

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
