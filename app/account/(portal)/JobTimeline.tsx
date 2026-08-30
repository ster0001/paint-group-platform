import Link from "next/link";
import { melbourneTodayYmd, signPhotosByIds, type PortalProject } from "@/lib/portal/data";
import { areaRollups, buildTimeline, dayHeading, type TimelineInput } from "@/lib/portal/timeline";
import { dayOfJob } from "@/lib/portal/home";
import { moneyFmt } from "@/lib/portal/money";
import PhotoGrid, { type GridPhoto } from "./project/PhotoGrid";

/**
 * THE job timeline — one component for both portals (trade portal v2 §5.3:
 * never fork it). Residential renders it from /account/project exactly as
 * 3a-4 built it; the trade property route renders the same component with a
 * back link and the extra trade events threaded through the same feed. The
 * snapshot test pins that identical input produces identical output.
 */
export default async function JobTimeline({ project, companyPhone, greet, h1, backLink, tradeEvents }: {
  project: PortalProject;
  companyPhone: string;
  greet?: string;
  h1?: string;
  backLink?: { href: string; label: string };
  tradeEvents?: TimelineInput["tradeEvents"];
}) {
  const today = melbourneTodayYmd();
  const items = buildTimeline({ ...project.timeline, todayYmd: today, tradeEvents });
  // Sign only what renders: at most 4 photos per card and 12 on the first
  // screen of the feed (volume law §10.3 — each signature is a storage call).
  let signBudget = 12;
  for (const item of items) {
    item.photoIds = item.photoIds.slice(0, Math.min(4, signBudget));
    signBudget -= item.photoIds.length;
  }
  const photosById = await signPhotosByIds(project.photoRows, items.flatMap((i) => i.photoIds));
  const rollups = areaRollups(project.timeline.surfaces);
  const dayChip = dayOfJob(project.startDate, project.endDate, today);
  const showCrew = ["in_progress", "qa", "completion_prep", "walkthrough"].includes(project.stage);

  const gridFor = (photoIds: string[]): GridPhoto[] =>
    photoIds
      .map((id) => photosById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, fullUrl: p.fullUrl, caption: p.caption, area: p.area }));

  // Day headings render once per day — derived up front (render stays pure).
  const withHeadings = items.map((item, i) => ({
    item,
    heading: items[i - 1]?.dayYmd === item.dayYmd ? null : dayHeading(item.dayYmd, today),
  }));

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
              href={`/s/${project.reportToken}`}>Open</a>
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
              <span className="nm">{r.heading}</span>
              <span className={`chip ${r.chip.cls}`}>{r.chip.label}</span>
            </div>
          ))}
        </div>
      )}

      {showCrew && (
        <>
          <h2>Who&rsquo;s at your home</h2>
          <div className="card">
            {project.painterFirstName && (
              <div className="person">
                <div className="pface m">{project.painterFirstName[0]?.toUpperCase()}</div>
                <div>
                  <div className="pname">{project.painterFirstName}</div>
                  <div className="prole">Your painter</div>
                </div>
              </div>
            )}
            <div className="person">
              <div className="pface d">PG</div>
              <div>
                <div className="pname">Your project coordinator</div>
                <div className="prole">
                  The office checks every day&rsquo;s work{companyPhone ? ` — ${companyPhone}` : ""}
                </div>
              </div>
            </div>
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
                <p className="sub" style={{ marginTop: 4 }}>{item.body}</p>
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
                  <div className="mmeta">CHECKED AND SENT BY THE OFFICE</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
