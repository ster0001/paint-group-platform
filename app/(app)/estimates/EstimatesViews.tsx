import Link from "next/link";
import { ESTIMATE_VIEWS, ESTIMATE_VIEW_LABEL, estimateViewHref, type EstimateView } from "@/lib/estimate/views";

/**
 * Estimates tab session 3 (brief §4, ruling E‑I): the six chips above the
 * list. All estimates keeps today's nine tabs INSIDE it — the chips never
 * replace them. On a phone the row scrolls sideways instead of wrapping.
 */
export default function EstimatesViews({ current }: { current: Exclude<EstimateView, "automations"> }) {
  return (
    <nav className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Estimates views" data-testid="estimates-views">
      {ESTIMATE_VIEWS.map((v) => {
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

/** Where each view's information lives until its session builds it (4 = Pipeline/Online now/Work queue, 5 = Funnel). */
const SOON: Record<"pipeline" | "online" | "queue" | "funnel", { line: string; href: string; link: string }> = {
  pipeline: { line: "Pipeline — estimates in lanes by stage — is the next build.", href: "/crm/pipeline", link: "Customers by stage are in CRM › Pipeline" },
  online: { line: "Online now and dropped is the next build.", href: "/estimates?status=wizard", link: "Live and dropped wizard sessions are on the Wizard tab" },
  queue: { line: "The work queue view is the next build.", href: "/estimates?status=waiting", link: "What is waiting on you is on the Waiting tab" },
  funnel: { line: "The Funnel report comes after the next build.", href: "/home", link: "The headline counts are on the home dashboard’s Where estimates go" },
};

export function ViewComingSoon({ view }: { view: keyof typeof SOON }) {
  const s = SOON[view];
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500" data-testid="estimates-view-soon">
      <p>{s.line}</p>
      <p className="mt-2"><Link href={s.href} className="font-medium text-gray-700 hover:underline">{s.link} →</Link></p>
    </div>
  );
}
