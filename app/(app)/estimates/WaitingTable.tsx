"use client";

import { useState } from "react";
import Link from "next/link";
import type { WorkItem } from "@/lib/crm/work-queue";
import { hideWaitingItemsAction, unhideWaitingItemsAction } from "./actions";

/**
 * C7b — "Waiting on you": the work queue, filtered to estimates.
 *
 * THE WHOLE POINT OF THIS COMPONENT IS WHAT IT DOES NOT DO. It runs no query,
 * derives no bucket, counts nothing and decides no priority. Every row here
 * came out of `lib/crm/work-queue.ts` — the same evaluator CRM Today reads —
 * already sorted, already bucketed, already carrying its own action. A second
 * list would be a second opinion about what needs attention, and C5's brief
 * asked for exactly that before anyone had looked at this page.
 *
 * So this is a renderer. If a row is wrong, the evaluator is wrong, and there
 * is one place to go and fix it.
 *
 * The Value column reads `WorkItem.valueCents`, which the evaluator now keeps
 * (Tom's ruling, 12 Sep). It always HAD the number — it folds it into
 * `priority`, which is what orders these rows — and simply discarded it, so
 * any surface wanting to show the figure had to fetch the same rows again.
 * One field on the contract removed that second query. `null` means the
 * record genuinely has no figure, not "not looked up", so it renders as a
 * dash rather than a zero.
 *
 * Tom, 15 Sep: tick boxes and a Remove button. Removing takes the row off
 * THIS list — `estimates_waiting_hidden`, keyed by the item's own key — and
 * nothing else: the CRM still shows it, the badge still counts it. That is
 * why the button says "Remove from this list" and not "Delete" or "Dismiss":
 * the estimate is not deleted and the work item is not dismissed. It went
 * client-side for the ticks; the rows are still whatever the evaluator said.
 *
 * The removal is optimistic, like the estimates table: the rows go the moment
 * you click, the server catches up behind, and they only come back if it
 * refused. An Undo sits in the confirmation line for the one case a tick was
 * on the wrong row.
 */

const BUCKET_TONE: Record<string, string> = {
  overdue: "border-l-[3px] border-l-[#b3574a] bg-[#b3574a]/[0.04]",
  today: "border-l-[3px] border-l-amber-500 bg-amber-50/40",
  waiting: "border-l-[3px] border-l-transparent",
};

const BUCKET_LABEL: Record<string, string> = {
  overdue: "Overdue",
  today: "Today",
  waiting: "Waiting",
};

/** "41m", "3h", "2d" — the same shorthand the wizard column uses. */
function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (60 * 24))}d`;
}

export default function WaitingTable({ items, now }: { items: WorkItem[]; now: Date }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Gone from the list; the server is (or was) catching up. */
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [lastRemoved, setLastRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = items.filter((i) => !removed.has(i.key));
  const allTicked = visible.length > 0 && visible.every((i) => selected.has(i.key));

  const toggle = (key: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAll = () => setSelected(allTicked ? new Set() : new Set(visible.map((i) => i.key)));
  const setGone = (keysToChange: string[], gone: boolean) =>
    setRemoved((s) => { const n = new Set(s); for (const k of keysToChange) { if (gone) n.add(k); else n.delete(k); } return n; });

  async function removeSelected() {
    const keysNow = visible.filter((i) => selected.has(i.key)).map((i) => i.key);
    if (keysNow.length === 0 || busy) return;
    setError(null);
    setSelected(new Set());
    setGone(keysNow, true);
    setLastRemoved(keysNow);
    setBusy(true);
    const r = await hideWaitingItemsAction(keysNow);
    setBusy(false);
    if (!r.ok) {
      // Only a refusal brings rows back — and then with the reason beside them.
      setGone(keysNow, false);
      setLastRemoved([]);
      setError(r.message);
    }
  }

  async function undo() {
    const keysBack = lastRemoved;
    if (keysBack.length === 0 || busy) return;
    setError(null);
    setLastRemoved([]);
    setGone(keysBack, false);
    setBusy(true);
    const r = await unhideWaitingItemsAction(keysBack);
    setBusy(false);
    if (!r.ok) {
      setGone(keysBack, true);
      setError(r.message);
    }
  }

  const notice = (error || lastRemoved.length > 0) && (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" data-testid="waiting-notice">
      {error ? (
        <span className="text-red-700" data-testid="waiting-error">{error}</span>
      ) : (
        <>
          <span className="text-gray-600" data-testid="waiting-removed-line">
            {lastRemoved.length === 1 ? "1 row removed" : `${lastRemoved.length} rows removed`} from this list. It&rsquo;s still in the CRM.
          </span>
          <button onClick={undo} disabled={busy} className="font-medium text-gray-800 underline hover:text-gray-900 disabled:opacity-50" data-testid="waiting-undo">
            Undo
          </button>
        </>
      )}
    </div>
  );

  if (visible.length === 0) {
    return (
      <>
        {notice}
        <p className="mt-8 text-sm text-gray-500" data-testid="waiting-empty">
          Nothing is waiting on you. Anything a customer asks for lands here.
        </p>
      </>
    );
  }

  const nSelected = visible.filter((i) => selected.has(i.key)).length;

  return (
    <>
      {notice}
      {nSelected > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs" data-testid="waiting-bulk-bar">
          <span className="text-gray-700">{nSelected} selected</span>
          <button
            onClick={removeSelected}
            disabled={busy}
            className="rounded bg-gray-900 px-2.5 py-1 font-medium text-white hover:bg-black disabled:opacity-50"
            data-testid="waiting-remove"
          >
            Remove from this list
          </button>
          <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-800" data-testid="waiting-clear">
            Clear
          </button>
          <span className="text-gray-500">Removing only tidies this screen — the CRM keeps the item.</span>
        </div>
      )}
      <table className="mt-4 w-full text-sm" data-testid="waiting-table">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="w-8 py-2 pl-3 pr-2">
              <input
                type="checkbox"
                checked={allTicked}
                onChange={toggleAll}
                aria-label="Select all waiting rows"
                data-testid="waiting-tick-all"
              />
            </th>
            <th className="py-2 pr-3 font-medium">What&rsquo;s waiting</th>
            <th className="py-2 pr-3 font-medium">Since</th>
            <th className="py-2 pr-3 font-medium">Value</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((i) => (
            <tr
              key={i.key}
              className={`border-b border-gray-100 align-top ${BUCKET_TONE[i.bucket] ?? ""}`}
              data-testid={`waiting-row-${i.subjectRef.id}`}
              data-bucket={i.bucket}
            >
              <td className="py-3 pl-3 pr-2">
                <input
                  type="checkbox"
                  checked={selected.has(i.key)}
                  onChange={() => toggle(i.key)}
                  aria-label={`Select ${i.title}`}
                  data-testid={`waiting-tick-${i.subjectRef.id}`}
                />
              </td>
              <td className="py-3 pr-3">
                <div className="font-medium text-gray-900">{i.title}</div>
                {/* The evaluator's own sentence. It already says what we promised
                    and whether that promise has passed — rewriting it here would
                    be the second opinion this component exists to avoid. */}
                <div className="mt-0.5 text-xs leading-relaxed text-gray-600">{i.detail}</div>
              </td>
              <td className="whitespace-nowrap py-3 pr-3 text-xs text-gray-500">
                <span className="font-mono">{ago(i.since, now)}</span>
                {i.bucket !== "waiting" && (
                  <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-600">
                    {BUCKET_LABEL[i.bucket]}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap py-3 pr-3 font-mono text-xs text-gray-700" data-testid={`waiting-value-${i.subjectRef.id}`}>
                {i.valueCents != null ? `$${Math.round(i.valueCents / 100).toLocaleString("en-AU")}` : "—"}
              </td>
              <td className="whitespace-nowrap py-3 pr-3 text-right">
                <Link
                  href={i.action.href}
                  className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
                  data-testid={`waiting-action-${i.subjectRef.id}`}
                >
                  {i.action.label}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
