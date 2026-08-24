import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reportIfError } from "@/lib/monitoring/report";
import type { WorkOrderDoc as WODoc } from "@/lib/workorder/snapshot";
import { ticksBySurfaceKey, type SurfaceState } from "@/lib/workorder/surfaces";
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

  // The snapshot's per-surface status is frozen at issue. The ticks are live, so
  // ask for them — an RPC because this route is anon and RLS quite rightly will
  // not show wo_surfaces to a caller with no session. Degrades to the frozen
  // statuses if the RPC isn't there yet, rather than 500ing a contractor's job
  // sheet on a Monday morning.
  const { data: tickRows } = await supabase.rpc("get_work_order_ticks_by_token", { p_token: token });
  const tickList = (tickRows as { surface_key: string | null; state: SurfaceState; removed?: boolean }[] | null) ?? [];
  const ticks = ticksBySurfaceKey(tickList);
  // Struck by a signed credit (A3) — the job sheet shows the strike, never a
  // silently shorter list. Degrades to none before migration 20261118.
  const removedKeys = tickList.filter((t) => t.removed && t.surface_key).map((t) => t.surface_key!);

  const doc: WODoc = { ...row.snapshot, status: row.status ?? row.snapshot.status, startDate: row.start_date ?? row.snapshot.startDate };
  return <WorkOrderDoc doc={doc} ticks={ticks} removedKeys={removedKeys} />;
}
