import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import NewEstimateButton, { type TemplateMeta } from "./NewEstimateButton";
import EstimatesTable, { type EstimateRow } from "./EstimatesTable";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "draft", "sent", "accepted", "declined", "expired"] as const;

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("estimates")
    .select("id, title, status, total_cents, created_at")
    .order("created_at", { ascending: false });
  if (status && status !== "all") query = query.eq("status", status);
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
    </div>
  );
}
