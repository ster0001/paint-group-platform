import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalProject, getPortalProjects } from "@/lib/portal/data";
import { shortAddress } from "@/lib/portal/homeList";
import ComingCard from "../ComingCard";
import JobTimeline from "../JobTimeline";

export const dynamic = "force-dynamic";

/**
 * 3a-4 · The Project Timeline (§4-D): the job day by day, newest at top,
 * rendered entirely from what the WO loop already captures. Since trade
 * portal v2 session 4 the rendering lives in the SHARED JobTimeline
 * component — both portals import that one place, never a fork.
 *
 * D1 (portal UX brief, 25 Oct 2026): with more than one job the page carries
 * a switcher — the same chip strip as Home, minus "Everything" — and Home's
 * cards deep-link here with `?project=<work order id>`.
 */
export default async function ProjectPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project: projectParam } = await searchParams;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const accountIds = ctx.accounts.map((a) => a.id);
  const projects = await getPortalProjects(accountIds);
  const project = await getPortalProject(accountIds, projectParam ?? null);
  if (!project) {
    return (
      <ComingCard
        title="My project"
        body="Once your painting is booked, this is where you'll watch it happen — photos as they're taken, what's done and what's next, and the people looking after your home, day by day."
      />
    );
  }

  const current = projects.find((p) => p.estimateId === project.estimateId)?.workOrderId ?? null;

  return (
    <div>
      {projects.length >= 2 && (
        <div className="strip" data-testid="project-switcher" style={{ marginBottom: 8 }}>
          {projects.map((p) => (
            <Link
              key={p.workOrderId}
              href={`/account/project?project=${p.workOrderId}`}
              className={`addr-chip${p.workOrderId === current ? " on" : ""}`}
              aria-current={p.workOrderId === current ? "page" : undefined}
              data-testid="project-chip"
            >
              {shortAddress(p.title)}
            </Link>
          ))}
        </div>
      )}
      <JobTimeline project={project} companyPhone={ctx.companyPhone} coordinatorName={ctx.coordinatorName} />
    </div>
  );
}
