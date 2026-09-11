import Link from "next/link";
import type { WorkItem } from "@/lib/crm/work-queue";

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
  if (items.length === 0) {
    return (
      <p className="mt-8 text-sm text-gray-500" data-testid="waiting-empty">
        Nothing is waiting on you. Anything a customer asks for lands here.
      </p>
    );
  }

  return (
    <table className="mt-4 w-full text-sm" data-testid="waiting-table">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
          <th className="py-2 pr-3 font-medium">What&rsquo;s waiting</th>
          <th className="py-2 pr-3 font-medium">Since</th>
          <th className="py-2 pr-3 font-medium">Value</th>
          <th className="py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr
            key={i.key}
            className={`border-b border-gray-100 align-top ${BUCKET_TONE[i.bucket] ?? ""}`}
            data-testid={`waiting-row-${i.subjectRef.id}`}
            data-bucket={i.bucket}
          >
            <td className="py-3 pl-3 pr-3">
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
  );
}
