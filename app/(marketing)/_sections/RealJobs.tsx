import Link from "next/link";
import JobCard from "../_components/JobCard";
import { featuredShowcaseJobs } from "@/lib/showcase/queries";

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

export default async function RealJobs() {
  const featured = await featuredShowcaseJobs();
  const gaps = PLACEHOLDERS.slice(featured.length, 3);
  return (
    <section className="sec light" id="jobs">
      <div className="wrap">
        <div className="head">
          <div>
            <div className="mono" style={{ color: "var(--color-tmut)", marginBottom: 12 }}>Real jobs · real prices · inc. GST</div>
            <h2>What Melbourne homes actually cost to paint.</h2>
            <p className="lead" style={{ marginTop: 14 }}>Every card is a finished job with the real price. Tap one and we&rsquo;ll open the estimator pre-filled with the same scope.</p>
          </div>
          <Link href="/work" style={{ fontWeight: 500 }}>All jobs →</Link>
        </div>
        <div className="jobs" data-testid="featured-jobs">
          {featured.map((j, i) => <JobCard key={j.id} job={j} priority={i === 0} />)}
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
