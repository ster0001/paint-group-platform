import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/contractor/session";
import { getContractorJob } from "@/lib/contractor/jobs";
import WorkOrderDoc from "@/app/w/WorkOrderDoc";

export const dynamic = "force-dynamic";

// The signed-in contractor's own work order. Same document the public
// /w/[token] link serves — read-only, contractor-safe, no customer pricing or
// margin — but reached through their login rather than a shared link.
export default async function PortalJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { contractor } = await requireContractor();
  if (!contractor) notFound();

  const job = await getContractorJob(contractor.id, id);
  if (!job || !job.doc) notFound();

  // Best-effort "seen it" stamp so staff know the job landed.
  const supabase = await createClient();
  await supabase.rpc("contractor_mark_wo_viewed", { p_work_order_id: id }).then(
    () => {},
    () => {},
  );

  return (
    <div className="wrap" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div style={{ padding: "0 16px" }}>
        <Link href="/portal/jobs" className="backlink">
          ← Jobs
        </Link>
      </div>
      <WorkOrderDoc doc={job.doc} />
    </div>
  );
}
