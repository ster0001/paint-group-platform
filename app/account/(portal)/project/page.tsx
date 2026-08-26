import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalProject, melbourneTodayYmd } from "@/lib/portal/data";
import { areaRollups, buildTimeline, dayHeading } from "@/lib/portal/timeline";
import { dayOfJob } from "@/lib/portal/home";
import { moneyFmt } from "@/lib/portal/money";
import PhotoGrid, { type GridPhoto } from "./PhotoGrid";
import ComingCard from "../ComingCard";

export const dynamic = "force-dynamic";

/**
 * 3a-4 · The Project Timeline (§4-D): the job day by day, newest at top,
 * rendered entirely from what the WO loop already captures. Photos are
 * sized renditions behind signed URLs; who's-on-your-job shows first names
 * only; QA appears only as a passed milestone.
 */
export default async function ProjectPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const project = await getPortalProject(ctx.accounts.map((a) => a.id));
  if (!project) {
    return (
      <ComingCard
        title="My project"
        body="Once your painting is booked, this is where you'll watch it happen — photos as they're taken, what's done and what's next, and the people looking after your home, day by day."
      />
    );
  }

  const today = melbourneTodayYmd();
  const items = buildTimeline({ ...project.timeline, todayYmd: today });
  const rollups = areaRollups(project.timeline.surfaces);
  const dayChip = dayOfJob(project.startDate, project.endDate, today);
  const showCrew = ["in_progress", "qa", "completion_prep", "walkthrough"].includes(project.stage);

  const gridFor = (photoIds: string[]): GridPhoto[] =>
    photoIds
      .map((id) => project.photosById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, fullUrl: p.fullUrl, caption: p.caption, area: p.area }));

  // Day headings render once per day — derived up front (render stays pure).
  const withHeadings = items.map((item, i) => ({
    item,
    heading: items[i - 1]?.dayYmd === item.dayYmd ? null : dayHeading(item.dayYmd, today),
  }));

  return (
    <div>
      <div className="greet">{project.title}</div>
      <h1>Your project, day by day</h1>

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
                  The office checks every day&rsquo;s work{ctx.companyPhone ? ` — ${ctx.companyPhone}` : ""}
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
