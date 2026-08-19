"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteEstimateAction } from "./actions";
import DeleteEstimateButton from "./DeleteEstimateButton";

/**
 * The estimates table with multi-select delete (Tom, 20 Aug 2026).
 *
 * Accepted estimates get no tickbox — they're the record of what the
 * customer agreed to, and the database refuses to delete them anyway.
 * Bulk delete runs the SAME per-estimate server action row by row, so every
 * database refusal (invoice attached, work order live…) is honoured and
 * reported per estimate rather than failing the whole batch.
 */

export type EstimateRow = {
  id: string;
  title: string | null;
  status: string;
  total_cents: number | null;
  created_at: string;
};

const money = (c: number | null) =>
  c == null ? "—" : "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 });

export default function EstimatesTable({ estimates }: { estimates: EstimateRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState<string[]>([]);

  const selectable = estimates.filter((e) => e.status !== "accepted");
  const allTicked = selectable.length > 0 && selectable.every((e) => selected.has(e.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setAsking(false);
  }

  function toggleAll() {
    setSelected(allTicked ? new Set() : new Set(selectable.map((e) => e.id)));
    setAsking(false);
  }

  async function removeSelected() {
    setBusy(true);
    setFailures([]);
    const ids = estimates.filter((e) => selected.has(e.id)).map((e) => e.id);
    const failed: string[] = [];
    let done = 0;
    // One at a time, through the same guarded action as the single button —
    // a refusal (invoice, work order) skips that row and names itself.
    for (const id of ids) {
      setProgress(`Deleting ${done + 1} of ${ids.length}…`);
      const r = await deleteEstimateAction({ estimateId: id });
      if (r.ok) done++;
      else {
        const title = estimates.find((e) => e.id === id)?.title || "Untitled estimate";
        failed.push(`“${title}”: ${r.message}`);
      }
    }
    setBusy(false);
    setProgress("");
    setAsking(false);
    setSelected(new Set()); // refusals show their reasons below instead
    setFailures(failed);
    router.refresh();
  }

  return (
    <>
      {selected.size > 0 && (
        <div data-bulkbar className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {!asking ? (
            <>
              <button
                onClick={() => setAsking(true)}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                Delete selected
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-800">
                Clear
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-gray-700">
                Delete {selected.size} estimate{selected.size === 1 ? "" : "s"}? Sent links stop working. This can&rsquo;t be undone.
              </span>
              <button
                onClick={removeSelected}
                disabled={busy}
                className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? progress || "Deleting…" : `Yes, delete ${selected.size}`}
              </button>
              <button onClick={() => setAsking(false)} disabled={busy} className="text-xs text-gray-500 hover:text-gray-800">
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {failures.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {failures.length === 1 ? "One estimate couldn't be deleted:" : `${failures.length} estimates couldn't be deleted:`}
          <ul className="mt-1 list-disc pl-4">
            {failures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all estimates on this page"
                  checked={allTicked}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-gray-900"
                />
              </th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
              <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {estimates.map((e) => (
              <tr key={e.id} className={`hover:bg-gray-50 ${selected.has(e.id) ? "bg-gray-50" : ""}`}>
                <td className="px-3 py-2.5">
                  {e.status !== "accepted" ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${e.title || "Untitled estimate"}`}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4 accent-gray-900"
                    />
                  ) : (
                    <span className="text-gray-300" title="Accepted estimates are kept as the record of what the customer agreed to" />
                  )}
                </td>
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
                <td className="px-4 py-2.5 text-right">
                  {e.status !== "accepted" && (
                    <Link
                      href={`/quote/capture?id=${e.id}`}
                      className="mr-3 text-xs text-gray-500 hover:text-gray-900 hover:underline"
                      title="On-site room-loop capture"
                    >
                      Capture
                    </Link>
                  )}
                  <DeleteEstimateButton
                    estimateId={e.id}
                    title={e.title || "Untitled estimate"}
                    status={e.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
