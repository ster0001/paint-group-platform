import Link from "next/link";
import JobCard from "../_components/JobCard";
import { featuredShowcaseJobs } from "@/lib/showcase/queries";
import Md from "../_components/Md";
import type { Audience } from "@/lib/marketing/audience";

/**
 * §4.4 — three JobCards driven by the showcase table: the three lowest
 * featured ranks among PUBLISHED jobs and nothing else. Until Tom has
 * published three (⚑9.2), the empty slots show the prototype's cards as
 * visible bracketed placeholders — never a draft.
 */
const PLACEHOLDERS = [
  { title: "[Exterior weatherboard]", days: 6, meta: "Thornbury · completed Jul 2026", price: "$14,200 – $15,800", scope: "Whole exterior, 2 coats, fascias & gutters, front fence", ph: "linear-gradient(135deg,#B9B3A5,#E4E0D6)" },
  { title: "[Interior Victorian]", days: 4, meta: "Fitzroy North · completed Aug 2026", price: "$8,400 – $9,600", scope: "4 rooms + hallway, walls, ceilings, trim", ph: "linear-gradient(135deg,#D8D3C7,#F2EFE8)" },
  { title: "[Commercial shopfront]", days: 3, meta: "Preston · completed Jun 2026", price: "$6,900 – $7,700", scope: "Exterior render + signage band, after-hours", ph: "linear-gradient(135deg,#9FA3A6,#D9DBDC)" },
];

export type JobsCopy = { kicker: string; h2: string; lead: string; allLink: string };

export default async function RealJobs({ audience, copy, prefix = "" }: { audience: Audience; copy: JobsCopy; prefix?: string }) {
  const featured = await featuredShowcaseJobs(audience);
  const gaps = PLACEHOLDERS.slice(featured.length, 3);
  return (
    <section className="sec light" id="jobs">
      <div className="wrap">
        <div className="head">
          <div>
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>{copy.kicker}</div>
            <h2>{copy.h2}</h2>
            <p className="lead" style={{ marginTop: 14 }}><Md src={copy.lead} inline /></p>
          </div>
          <Link href={`${prefix}/work`} style={{ fontWeight: 500 }}>{copy.allLink}</Link>
        </div>
        <div className="jobs" data-testid="featured-jobs">
          {featured.map((j, i) => <JobCard key={j.id} job={j} priority={i === 0} prefix={prefix} />)}
          {gaps.map((p) => (
            <div key={p.title} className="job placeholder" data-todo="9.2" data-testid="featured-placeholder">
              <div className="img" style={{ background: p.ph }} />
              <div className="body">
                <div className="top"><h3>{p.title}</h3><span className="meta">{p.days} days on site</span></div>
                <span className="meta">{p.meta}</span>
                <span className="price">{p.price}</span>
                <span className="scope">{p.scope}</span>
                <span className="btn btn-ink" aria-hidden="true">View this job →</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
