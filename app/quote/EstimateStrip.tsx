import type { PackBundle } from "./pack-load";
import { stripParts, stripVerdict } from "@/lib/wizard/strip";
import StripActions from "./StripActions";

/**
 * C7b (brief 3.1, ⚑41) — the strip under the header, above the tabs, on
 * EVERY tab of a wizard estimate: it is about the estimate, not the view.
 *
 * Every figure is the pack's (one read, `pack-load.ts`); the three buttons
 * call the C6 route through `StripActions`. With no open request there is
 * nothing to act on, so only the figures show — the buttons need a promise
 * to act upon, and inventing a request row from here would be a fourth
 * writer of that table.
 */
export default function EstimateStrip({ bundle }: { bundle: PackBundle }) {
  if (bundle.kind !== "pack") return null;
  const { pack, policy, loop, bandPct, docs, request, recommended } = bundle;
  const parts = stripParts({
    loop, bandPct, photos: docs.photos.length, spotsToPrice: pack.spotsToPrice,
    totalCents: pack.totalCents, verdict: pack.verdict, policy,
  });
  const verdict = stripVerdict({ verdict: pack.verdict });
  return (
    <div className="mx-auto max-w-6xl px-6 pt-4" data-testid="estimate-strip">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="font-mono text-xs text-gray-700" data-testid="strip-figures">{parts.join(" · ")}</div>
          <div className="mt-0.5 text-sm">
            <b className={pack.verdict.eligible ? "text-emerald-700" : "text-amber-700"} data-testid="strip-verdict">{verdict.headline}</b>
            <span className="text-gray-500"> — {verdict.detail}</span>
            {request?.status === "question_asked" && <span className="ml-2 text-xs text-amber-700">· a question is out with the customer</span>}
          </div>
        </div>
        {request ? (
          <StripActions requestId={request.id} recommended={recommended} eligible={pack.verdict.eligible} />
        ) : (
          <span className="text-xs text-gray-400" data-testid="strip-no-request">No open request — the customer hasn&rsquo;t sent it to you yet.</span>
        )}
      </div>
    </div>
  );
}
