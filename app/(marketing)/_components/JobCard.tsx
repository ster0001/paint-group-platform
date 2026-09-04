"use client";

import Image from "next/image";
import Link from "next/link";
import { track } from "@/lib/analytics";
import { formatCompletedOn, formatPriceRange, showcaseMediaUrl } from "@/lib/showcase/format";
import { JOB_TYPE_LABEL, type ShowcaseJob } from "@/lib/showcase/schema";

/**
 * §4.4 — the "Real jobs, real prices" card: finished photo (4:3), job type,
 * days on site, `SUBURB · COMPLETED MON YYYY`, price range in mono, the
 * one-line scope, `View this job →`. The whole card is the link; the click
 * fires `job_card` with the slug. Used on the homepage, /work and the
 * project page's "More jobs" block.
 */
export default function JobCard({ job, priority = false }: { job: ShowcaseJob; priority?: boolean }) {
  const price = job.price_low_cents != null && job.price_high_cents != null
    ? formatPriceRange(job.price_low_cents, job.price_high_cents) : "";
  const meta = [job.suburb, job.completed_on ? `completed ${formatCompletedOn(job.completed_on)}` : ""].filter(Boolean).join(" · ");
  return (
    <Link href={`/work/${job.slug}`} className="job" data-ev="job_card" onClick={() => track("job_card", { slug: job.slug })}>
      <div className="img">
        {job.hero_path && (
          <Image
            src={showcaseMediaUrl(job.hero_path)} alt={`${job.title}, ${job.suburb}`} fill
            sizes="(min-width: 960px) 33vw, 100vw" priority={priority}
            style={{ objectFit: "cover" }}
          />
        )}
      </div>
      <div className="body">
        <div className="top">
          <h3>{job.title}</h3>
          {job.days_on_site != null && <span className="meta">{job.days_on_site} day{job.days_on_site === 1 ? "" : "s"} on site</span>}
        </div>
        <span className="meta">{JOB_TYPE_LABEL[job.job_type]} · {meta}</span>
        {price && <span className="price">{price}</span>}
        {job.scope_line && <span className="scope">{job.scope_line}</span>}
        <span className="btn btn-ink">View this job →</span>
      </div>
    </Link>
  );
}
