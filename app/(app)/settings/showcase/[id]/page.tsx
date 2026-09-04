import { notFound } from "next/navigation";
import { getShowcaseJobForStaff, listEstimatesForLinking } from "@/lib/showcase/staff";
import ShowcaseEditor from "../ShowcaseEditor";

/** Settings → Showcase → one job. `new` creates; anything else must be a row staff can read. */
export const dynamic = "force-dynamic";

export default async function ShowcaseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isNew = id === "new";
  const [job, estimates] = await Promise.all([
    isNew ? Promise.resolve(null) : getShowcaseJobForStaff(id),
    listEstimatesForLinking(),
  ]);
  if (!isNew && !job) notFound();
  return <ShowcaseEditor initial={job} estimates={estimates} />;
}
