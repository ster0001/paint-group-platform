import { notFound } from "next/navigation";
import { getContractorSession } from "@/lib/contractor/session";
import { loadStandards } from "@/lib/standards/load";
import { levelFromParam, surfaceByKey } from "@/lib/standards/model";
import { StandardsUnavailable, SurfaceStandard } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

/**
 * One surface. With `?job=<id>&level=n` it is the "What we expect" link from a
 * work-order line: locked to that job's level with "See other levels"
 * (ruling S3). Without `job`, the level switch is free.
 */
export default async function PortalStandardsSurfacePage({ params, searchParams }: {
  params: Promise<{ surface: string }>; searchParams: Promise<{ level?: string; job?: string }>;
}) {
  await getContractorSession();
  const { surface: key } = await params;
  const { level: levelParam, job } = await searchParams;
  const { standards, error } = await loadStandards();
  if (!standards) return <div className="wrap"><StandardsUnavailable message={error} /></div>;
  const surface = surfaceByKey(standards, key);
  if (!surface) notFound();
  const lock = job && /^[0-9a-f-]{36}$/i.test(job) ? { job } : null;
  return (
    <div className="wrap">
      <SurfaceStandard
        standards={standards} surface={surface} level={levelFromParam(levelParam)} base="portal" lock={lock}
        back={lock ? { href: `/portal/jobs/${lock.job}`, label: "Job" } : { href: `/portal/help/standards?side=${surface.side}`, label: "Standards" }}
      />
    </div>
  );
}
