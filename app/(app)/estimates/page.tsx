import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewEstimateButton, { type TemplateMeta } from "./NewEstimateButton";
import EstimatesTable, { type EstimateRow } from "./EstimatesTable";
import AssistantFab from "@/app/quote/AssistantFab";
import { LIST_FILTERS as FILTERS, filterQuery } from "@/lib/estimate/displayStatus";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  // "Viewed" is sent + the customer's first open (viewed_at) — one DB status,
  // two tabs (Tom, 4 Sep). The row shows "viewed" the same way.
  const fq = filterQuery(status);
  let query = supabase
    .from("estimates")
    .select("id, title, status, total_cents, created_at, viewed_at")
    .order("created_at", { ascending: false });
  if (fq.status) query = query.eq("status", fq.status);
  if (fq.viewed === true) query = query.not("viewed_at", "is", null);
  if (fq.viewed === false) query = query.is("viewed_at", null);
  const { data: estimates } = await query;

  const { data: tplRow } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
  const templates: TemplateMeta[] = (Array.isArray(tplRow?.value) ? (tplRow!.value as { id: string; name: string }[]) : [])
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Estimates</h1>
        <NewEstimateButton templates={templates} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
        {FILTERS.map((f) => {
          const active = (status ?? "all") === f;
          return (
            <Link
              key={f}
              href={f === "all" ? "/estimates" : `/estimates?status=${f}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
                active ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {f}
            </Link>
          );
        })}
      </div>

      {estimates && estimates.length > 0 ? (
        <EstimatesTable estimates={estimates as EstimateRow[]} />
      ) : (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          No estimates{status && status !== "all" ? ` marked “${status}”` : ""} yet.{" "}
          <Link href="/quote" className="font-medium text-gray-700 hover:underline">
            Create one →
          </Link>
        </div>
      )}
      <AssistantFab estimateId={null} />
    </div>
  );
}
