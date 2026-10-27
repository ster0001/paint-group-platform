import Link from "next/link";
import { melbourneTodayYmd, type PortalProject } from "@/lib/portal/data";
import { portalPhotoRefs } from "@/lib/portal/photos";
import { areaRollups, buildTimeline, dayHeading, type TimelineInput } from "@/lib/portal/timeline";
import { dayOfJob } from "@/lib/portal/home";
import { moneyFmt } from "@/lib/portal/money";
import PhotoGrid, { type GridPhoto } from "./project/PhotoGrid";
import type { TimelineItem } from "@/lib/portal/timeline";

/**
 * Estimate live-progress phone (brief v4, Tom 19 Sep): the SAME feed markup,
 * fed precomputed items and already-public photo URLs. With `sample` set the
 * component renders only the day-by-day feed, signs nothing and reads nothing
 * from storage — `lib/progress-preview/jobTimelineSample.test.ts` pins that,
 * and `timeline.shared.test.ts` pins that both portals still render as before.
 */
export type SampleTimeline = {
  items: TimelineItem[];
  /** One heading per item, in order — stands in for the real date headings. */
  headings: string[];
  photos: Map<string, GridPhoto>;
};

/**
 * THE job timeline — one component for both portals (trade portal v2 §5.3:
 * never fork it). Residential renders it from /account/project exactly as
 * 3a-4 built it; the trade property route renders the same component with a
 * back link and the extra trade events threaded through the same feed. The
 * snapshot test pins that identical input produces identical output.
 */
export default async function JobTimeline({ project, companyPhone, coordinatorName, greet, h1, backLink, tradeEvents, sample }: {
  project: PortalProject;
  companyPhone: string;
  /** Settings → Company details → Project coordinator (Tom, 1 Sep). */
  coordinatorName?: string | null;
  greet?: string;
  h1?: string;
  backLink?: { href: string; label: string };
  tradeEvents?: TimelineInput["tradeEvents"];
  /** Feed-only render from sample data (the estimate's live-progress phone). */
  sample?: SampleTimeline;
}) {
  const today = melbourneTodayYmd();
  // Every photo renders (27 Oct 2026 — Chris, Rose Street: "I can't see the
  // photos"). Nothing is signed here: each tile points at
  // /account/photo/[id]?size=thumb and the browser fetches only what scrolls
  // into view (volume law §10.3 — one storage call per photo SEEN). The old
  // 12-signatures-per-page budget left every older day's card empty.
  const items = sample ? sample.items : buildTimeline({ ...project.timeline, todayYmd: today, tradeEvents });
  // Sample photos are the estimate's own public URLs — nothing to resolve.
  const photosById = sample ? sample.photos : portalPhotoRefs(project.photoRows);
  // D2: approved extras become one honest row (count + total) in place of "Variations · Not started".
  const rollups = areaRollups(project.timeline.surfaces, project.timeline.variations);
  const dayChip = dayOfJob(project.startDate, project.endDate, today);
  // D3: after sign-off the people stay on the page, in the past tense.
  const signedOff = project.stage === "closed";
  const showCrew = signedOff || ["in_progress", "qa", "completion_prep", "walkthrough"].includes(project.stage);

  const gridFor = (photoIds: string[]): GridPhoto[] =>
    photoIds
      .map((id) => photosById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, fullUrl: p.fullUrl, caption: p.caption, area: p.area, media: p.media }));

  // Day headings render once per day — derived up front (render stays pure).
  const withHeadings = items.map((item, i) => ({
    item,
    heading: sample ? (sample.headings[i] ?? null) : items[i - 1]?.dayYmd === item.dayYmd ? null : dayHeading(item.dayYmd, today),
  }));

  const feed = (
    <div className="tl">
      {withHeadings.map(({ item, heading }) => {
        return (
          <div key={item.key} className={`tl-item ${item.live ? "live" : "done"}`}>
            {heading && <div className="tl-date">{heading}</div>}
            <div className="card">
              <div className="row">
                <h3 style={{ margin: 0 }}>{item.title}</h3>
                {item.amountCents != null && (
                  <span className="money" style={{ fontSize: 15 }}>{moneyFmt(item.amountCents)}</span>
                )}
              </div>
              <p className="sub" style={{ marginTop: 4, whiteSpace: "pre-line" }}>{item.body}</p>
              <PhotoGrid photos={gridFor(item.photoIds)} />
              {item.chip && (
                <div className="row" style={{ marginTop: 12 }}>
                  <span className={`chip ${item.chip.cls}`}>{item.chip.label}</span>
                </div>
              )}
              {item.cta && (
                <div style={{ marginTop: 14 }}>
                  <Link className="btn btn-cyan" href={item.cta.href}>{item.cta.label}</Link>
                </div>
              )}
              {item.key.startsWith("update:") && (
                <div className="mmeta">Checked and sent by the office</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (sample) return feed;

  return (
    <div>
      {backLink && (
        <Link href={backLink.href} className="sub" style={{ display: "inline-block", marginBottom: 8 }}>
          ‹ {backLink.label}
        </Link>
      )}
      <div className="greet">{greet ?? project.title}</div>
      <h1>{h1 ?? "Your project, day by day"}</h1>

      {project.reportToken && (
        <div className="card raised" style={{ marginBottom: 22 }} data-testid="project-completion-report">
          <div className="row">
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700 }}>Your completion report</h3>
              <p className="sub" style={{ marginTop: 4 }}>
                Signed off and yours for good — everything delivered, area by area, with your warranty dates.
              </p>
            </div>
            <a className="btn btn-ghost" style={{ width: "auto", padding: "12px 18px", fontSize: 15 }}
              href={`/s/${project.reportToken}`}>Open report</a>
          </div>
        </div>
      )}

      {rollups.length > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Where everything is up to</h3>
            {dayChip && <span className="chip cyan">{dayChip}</span>}
          </div>
          {rollups.map((r) => (
            <div className="area" key={r.heading}>
              <span className="nm">
                {r.heading}
                {r.amountCents != null && <> · <span className="money">{moneyFmt(r.amountCents)}</span> inc GST</>}
              </span>
              <span className={`chip ${r.chip.cls}`}>{r.chip.label}</span>
            </div>
          ))}
        </div>
      )}

      {showCrew && (
        <>
          {/* Tom, 1 Sep: this section is the PAINTER only — the coordinator
              gets their own section below, with a name and a way in. */}
          <h2>{signedOff ? "Who painted your home" : "Who's at your home"}</h2>
          <div className="card">
            {project.painterFirstName ? (
              <div className="person">
                <div className="pface m">{project.painterFirstName[0]?.toUpperCase()}</div>
                <div>
                  <div className="pname">{project.painterFirstName}</div>
                  <div className="prole">
                    {signedOff
                      ? "Your painter"
                      : "Your painter · Please speak to me if you have any questions regarding how the job will be completed."}
                  </div>
                </div>
              </div>
            ) : (
              <p className="sub">Your painter&rsquo;s details appear here once the job is under way.</p>
            )}
          </div>

          <h2>{signedOff ? "Who looked after your job" : "Who is managing and overseeing the job"}</h2>
          <div className="card" data-testid="coordinator-card">
            <div className="person">
              <div className="pface d">{(coordinatorName || "P")[0]?.toUpperCase()}</div>
              <div>
                <div className="pname">{coordinatorName || "Your project coordinator"}</div>
                <div className="prole">
                  {signedOff
                    ? "Your project coordinator"
                    : "Your Project Coordinator · Please speak to me if you would like to make any changes to your scope, any progress updates or concerns."}
                  {companyPhone ? ` ${companyPhone}` : ""}
                </div>
              </div>
            </div>
            <Link
              href={`/account/messages/${project.estimateId}`}
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 18px", fontSize: 14, marginTop: 10, display: "inline-block" }}
              data-testid="message-coordinator"
            >
              {project.replyTo ? `Reply to ${project.replyTo}` : "Message me"}
            </Link>
          </div>
        </>
      )}

      <h2>Day by day</h2>
      {items.length === 0 && (
        <div className="card raised">
          <p className="sub">
            Nothing to show just yet — the moment there&rsquo;s movement on your project, it lands here,
            photos and all.
          </p>
        </div>
      )}

      {feed}
    </div>
  );
}
