import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const money = (c: number | null) =>
  c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 });

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Estimates</h1>
        <Link
          href="/quote"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + New estimate
        </Link>
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

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {estimates && estimates.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {estimates.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/quote?id=${e.id}`} className="font-medium hover:underline">
                      {e.title || "Untitled estimate"}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 capitalize text-gray-500">{e.status}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {new Date(e.created_at).toLocaleDateString("en-AU")}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money(e.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-10 text-center text-sm text-gray-400">
            No estimates{status && status !== "all" ? ` marked “${status}”` : ""} yet.{" "}
            <Link href="/quote" className="font-medium text-gray-700 hover:underline">
              Create one →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
