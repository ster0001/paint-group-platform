import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reportIfError } from "@/lib/monitoring/report";
import type { WorkOrderDoc as WODoc } from "@/lib/workorder/snapshot";
import WorkOrderDoc from "../WorkOrderDoc";

export const dynamic = "force-dynamic";

// Public, token-only contractor link. Same pattern as /e/[token]: the anon key
// never gets a select on work_orders; a security-definer RPC returns only the
// contractor-safe wo_snapshot, and only for ISSUED work orders.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_work_order_by_token", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as { snapshot: WODoc | null; status: string; start_date: string | null } | undefined;
  if (error || !row || !row.snapshot || (row.snapshot as Partial<WODoc>).version !== 1) notFound();

  // best-effort view logging
  // Best-effort view stamp: a contractor must still get their job sheet if it
  // fails. Reported so a silent failure isn't invisible.
  reportIfError(await supabase.rpc("record_work_order_view", { p_token: token }), {
    where: "workorder.viewStamp",
    bestEffort: true,
  });

  const doc: WODoc = { ...row.snapshot, status: row.status ?? row.snapshot.status, startDate: row.start_date ?? row.snapshot.startDate };
  return <WorkOrderDoc doc={doc} />;
}
