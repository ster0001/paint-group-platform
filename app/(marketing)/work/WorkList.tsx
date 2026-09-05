"use client";

import { useMemo, useState } from "react";
import Chip from "../_components/Chip";
import JobCard from "../_components/JobCard";
import { JOB_TYPES, JOB_TYPE_LABEL, type JobType, type PropertyType, type ShowcaseJob } from "@/lib/showcase/schema";

/** The /work grid with its two chip rows (same Chip as the hero). Client-side only — no URL state needed. */
export default function WorkList({ jobs }: { jobs: ShowcaseJob[] }) {
  const [type, setType] = useState<JobType | "all">("all");
  const [property, setProperty] = useState<PropertyType | "all">("all");

  const shown = useMemo(
    () => jobs.filter((j) => (type === "all" || j.job_type === type) && (property === "all" || j.property_type === property)),
    [jobs, type, property],
  );
  const typesPresent = JOB_TYPES.filter((t) => jobs.some((j) => j.job_type === t));

  return (
    <>
      <div className="work-filters">
        <div className="chips" role="group" aria-label="Job type">
          <span className="mono" style={{ color: "var(--color-tmut)" }}>Type</span>
          <Chip pressed={type === "all"} onClick={() => setType("all")}>All</Chip>
          {typesPresent.map((t) => <Chip key={t} pressed={type === t} onClick={() => setType(t)}>{JOB_TYPE_LABEL[t]}</Chip>)}
        </div>
        <div className="chips" role="group" aria-label="Property">
          <span className="mono" style={{ color: "var(--color-tmut)" }}>For</span>
          <Chip pressed={property === "all"} onClick={() => setProperty("all")}>All</Chip>
          <Chip pressed={property === "home"} onClick={() => setProperty("home")}>Homes</Chip>
          <Chip pressed={property === "business"} onClick={() => setProperty("business")}>Businesses</Chip>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="lead work-empty" data-todo="9.2">
          {jobs.length === 0 ? "[The first finished jobs are being written up. Check back soon.]" : "No jobs match those filters yet."}
        </p>
      ) : (
        <div className="jobs" data-testid="work-grid">
          {shown.map((j, i) => <JobCard key={j.id} job={j} priority={i < 3} />)}
        </div>
      )}
    </>
  );
}
