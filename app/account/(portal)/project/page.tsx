import { redirect } from "next/navigation";
import { getPortalContext, getPortalProject } from "@/lib/portal/data";
import ComingCard from "../ComingCard";
import JobTimeline from "../JobTimeline";

export const dynamic = "force-dynamic";

/**
 * 3a-4 · The Project Timeline (§4-D): the job day by day, newest at top,
 * rendered entirely from what the WO loop already captures. Since trade
 * portal v2 session 4 the rendering lives in the SHARED JobTimeline
 * component — both portals import that one place, never a fork.
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

  return <JobTimeline project={project} companyPhone={ctx.companyPhone} />;
}
