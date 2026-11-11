import Link from "next/link";
import { ESTIMATE_VIEWS, ESTIMATE_VIEW_LABEL, estimateViewHref, type EstimateView } from "@/lib/estimate/views";

/**
 * Estimates tab session 3 (brief §4, ruling E‑I): the six chips above the
 * list. All estimates keeps today's nine tabs INSIDE it — the chips never
 * replace them. On a phone the row scrolls sideways instead of wrapping.
 */
export default function EstimatesViews({ current, hidden = [] }: { current: Exclude<EstimateView, "automations">; hidden?: readonly EstimateView[] }) {
  return (
    <nav className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Estimates views" data-testid="estimates-views">
      {ESTIMATE_VIEWS.filter((v) => !hidden.includes(v)).map((v) => {
        const on = v === current;
        return (
          <Link
            key={v}
            href={estimateViewHref(v)}
            data-view={v}
            data-testid={`estimates-view-${v}`}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium ${
              on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {ESTIMATE_VIEW_LABEL[v]}
          </Link>
        );
      })}
    </nav>
  );
}
