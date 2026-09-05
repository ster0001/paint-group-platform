import Image from "next/image";
import Gallery from "./Gallery";
import GetPriceLike from "./GetPriceLike";
import JobCard from "./JobCard";
import { formatCompletedOn, formatPriceRange, showcaseMediaUrl } from "@/lib/showcase/format";
import { JOB_TYPE_LABEL, type ShowcaseJob } from "@/lib/showcase/schema";
import { swatchHex } from "@/lib/showcase/swatches";

/**
 * §4.4c — THE project page template. Every /work/[slug] renders these nine
 * blocks in this order, from one showcase_jobs row; blocks 5–7 are omitted
 * cleanly when empty. The Settings → Showcase editor renders this same
 * component as its live preview (`preview`), so what Tom fills in top to
 * bottom is what a visitor reads top to bottom. Read-only; not a page
 * builder (⚑9.12).
 */
export default function ProjectPage({ job, related = [], preview = false }: {
  job: ShowcaseJob;
  /** Block 9 — three other published jobs, same type first (lib/showcase/queries). */
  related?: ShowcaseJob[];
  preview?: boolean;
}) {
  const price = job.price_low_cents != null && job.price_high_cents != null
    ? formatPriceRange(job.price_low_cents, job.price_high_cents) : null;
  const metaBits = [
    job.suburb,
    job.completed_on ? `completed ${formatCompletedOn(job.completed_on)}` : null,
    job.days_on_site != null ? `${job.days_on_site} day${job.days_on_site === 1 ? "" : "s"} on site` : null,
  ].filter(Boolean);

  return (
    <article className="pp" data-testid={preview ? "showcase-preview" : "project-page"}>
      {/* 1 · Hero */}
      <header className="pp-hero">
        {job.hero_path ? (
          <Image src={showcaseMediaUrl(job.hero_path)} alt={`${job.title} in ${job.suburb}`} fill priority sizes="100vw" style={{ objectFit: "cover" }} />
        ) : (
          <div className="pp-hero-empty" aria-hidden="true" />
        )}
        <div className="pp-hero-copy">
          <span className="mono">{JOB_TYPE_LABEL[job.job_type]} · {job.property_type === "home" ? "home" : "business"}</span>
          <h1>{job.title || "Untitled job"}</h1>
          <span className="mono pp-meta">{metaBits.join(" · ").toUpperCase()}</span>
          {price && <span className="pp-price">{price}</span>}
          {price && <span className="mono pp-gst">inc. GST</span>}
        </div>
      </header>

      <div className="light">
        <div className="wrap pp-body">
          {/* 2 · Summary */}
          {job.summary && (
            <section className="pp-block" aria-label="Summary">
              <p className="lead pp-summary">{job.summary}</p>
            </section>
          )}

          {/* 3 · What we did */}
          {job.what_we_did.length > 0 && (
            <section className="pp-block" aria-labelledby="pp-wwd">
              <h2 id="pp-wwd">What we did</h2>
              <dl className="pp-wwd">
                {job.what_we_did.map((r, i) => (
                  <div key={i} className="pp-wwd-row"><dt>{r.area}</dt><dd>{r.work}</dd></div>
                ))}
              </dl>
            </section>
          )}

          {/* 4 · Gallery */}
          {job.gallery.length > 0 && (
            <section className="pp-block" aria-labelledby="pp-gal">
              <h2 id="pp-gal">Before, during, after</h2>
              <Gallery items={job.gallery} title={job.title} />
            </section>
          )}

          {/* 5 · Colours */}
          {job.colours.length > 0 && (
            <section className="pp-block" aria-labelledby="pp-col">
              <h2 id="pp-col">Colours</h2>
              <ul className="pp-colours">
                {job.colours.map((c, i) => {
                  const hex = swatchHex(c.brand, c.colour);
                  return (
                    <li key={i} className="pp-colour">
                      <span className={`pp-swatch${hex ? "" : " neutral"}`} style={hex ? { background: hex } : undefined} aria-hidden="true" />
                      <span className="pp-colour-t">
                        <b>{c.colour}</b>
                        <small className="mono">{[c.brand, c.product].filter(Boolean).join(" · ")}{c.surface ? ` · ${c.surface}` : ""}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* 6 · Condition */}
          {job.condition_notes && (
            <section className="pp-block" aria-labelledby="pp-cond">
              <h2 id="pp-cond">What it was like before</h2>
              <p className="pp-text">{job.condition_notes}</p>
            </section>
          )}

          {/* 7 · What the customer said */}
          {job.review_quote && (
            <section className="pp-block" aria-labelledby="pp-quote">
              <h2 id="pp-quote">What the customer said</h2>
              <blockquote className="pp-quote">
                <p>“{job.review_quote}”</p>
                {job.review_name && <footer className="mono">{job.review_name}</footer>}
              </blockquote>
            </section>
          )}
        </div>
      </div>

      {/* 8 · Get a price like this */}
      <GetPriceLike job={job} preview={preview} />

      {/* 9 · More jobs */}
      {related.length > 0 && (
        <section className="light warm sec" aria-labelledby="pp-more">
          <div className="wrap">
            <h2 id="pp-more">More jobs</h2>
            <div className="jobs">
              {related.slice(0, 3).map((j) => <JobCard key={j.id} job={j} />)}
            </div>
          </div>
        </section>
      )}
    </article>
  );
}
