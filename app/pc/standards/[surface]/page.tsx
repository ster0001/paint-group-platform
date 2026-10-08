import { notFound } from "next/navigation";
import { loadStandards } from "@/lib/standards/load";
import { levelFromParam, surfaceByKey } from "@/lib/standards/model";
import { StandardsUnavailable, SurfaceStandard } from "@/app/components/standards/StandardsViews";

export const dynamic = "force-dynamic";

/** One surface, as the quality-check screen links it: locked to the job's level with `?job=&level=`. */
export default async function PcStandardsSurfacePage({ params, searchParams }: {
  params: Promise<{ surface: string }>; searchParams: Promise<{ level?: string; job?: string }>;
}) {
  const { surface: key } = await params;
  const { level: levelParam, job } = await searchParams;
  const { standards, error } = await loadStandards();
  if (!standards) return <div className="card" style={{ marginTop: 14 }}><StandardsUnavailable message={error} /></div>;
  const surface = surfaceByKey(standards, key);
  if (!surface) notFound();
  const lock = job && /^[0-9a-f-]{36}$/i.test(job) ? { job } : null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <SurfaceStandard
        standards={standards} surface={surface} level={levelFromParam(levelParam)} base="pc" lock={lock}
        back={lock ? { href: `/pc/wo/${lock.job}`, label: "Job" } : { href: `/pc/standards?side=${surface.side}`, label: "Standards" }}
      />
    </div>
  );
}
