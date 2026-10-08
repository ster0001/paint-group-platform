"use client";

import { useState } from "react";
import type { MyJobResult } from "@/lib/painterStatus/mine";

/**
 * The last 10 jobs as dots, oldest on the left; tap one to see why. New
 * shows the slots still to fill. Display only — every word comes from the
 * row the evaluator wrote.
 */
export default function JobDots({ jobs, slots, smallJobHours }: { jobs: MyJobResult[]; slots: number; smallJobHours: number }) {
  const [sel, setSel] = useState<number | null>(null);
  const picked = sel !== null ? jobs[sel] : null;
  return (
    <>
      <div className="jobs" data-testid="job-dots">
        {jobs.map((j, i) => (
          <button key={j.workOrderId} type="button" className={`jd ${j.result === "clean" ? "ok" : "slip"}`} aria-pressed={sel === i}
            aria-label={`${j.title}, ${j.result === "clean" ? "clean" : "not clean"}`} onClick={() => setSel(sel === i ? null : i)}>
            {j.result === "clean" ? "✓" : "!"}
          </button>
        ))}
        {Array.from({ length: Math.max(0, slots - jobs.length) }, (_, i) => (
          <span key={`todo-${i}`} className="jd todo" aria-label="Job to come">{jobs.length + i + 1}</span>
        ))}
      </div>
      <p className="small muted">Oldest on the left. Tap a job to see why.</p>
      {picked && (
        <div className="result" data-testid="job-dot-detail">
          <div className="row"><b className="grow">{picked.title}</b><span className={`pill ${picked.result === "clean" ? "ok" : "bad"}`}>{picked.result === "clean" ? "Clean job" : "Not clean"}</span></div>
          <p className="small muted">{picked.hours} hours{picked.hours < smallJobHours ? " · small job: counts for your colour, not for a bonus" : ""}</p>
          {picked.result === "clean"
            ? <p className="small"><span className="tick">✓</span> Reminders answered &nbsp;<span className="tick">✓</span> Checks passed &nbsp;<span className="tick">✓</span> No call back</p>
            : <ul className="clean small">{picked.reasons.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
    </>
  );
}
