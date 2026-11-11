import Link from "next/link";
import { BrandPill } from "@/app/components/BrandPill";
import { stageAge, type Pipeline, type PipelineCard } from "@/lib/estimate/pipeline";
import CardMenu from "./PipelineCardMenu";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const BORDER: Record<string, string> = { hot: "border-l-red-500", warm: "border-l-amber-400", cold: "border-l-sky-400" };

/**
 * Estimates tab session 4 (brief §4.2): the Pipeline. Lanes B2 → C5, each with
 * its count and value; cards are read-only — there is no drag handle, because
 * the lane is derived (`estimateStageFor`), never set. Tap a card to open it;
 * the ⋯ menu sets the customer's temperature or snoozes them.
 */
export default function PipelineBoard({ pipeline, now }: { pipeline: Pipeline; now: Date }) {
  return (
    <section className="mt-4" data-testid="pipeline" data-total={pipeline.total}>
      <p className="text-sm text-gray-500">
        {pipeline.total} open · lanes are worked out from what happened, so cards move on their own
        {pipeline.snoozed > 0 && <> · <span data-testid="pipeline-snoozed">{pipeline.snoozed} snoozed</span></>}
      </p>
      <div className="mt-3 -mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-4 md:snap-none">
        {pipeline.lanes.map((lane) => (
          <div key={lane.stage} className="w-[85vw] max-w-[280px] shrink-0 snap-start rounded-lg bg-gray-50 p-2 md:w-64" data-testid={`lane-${lane.stage}`} data-count={lane.count}>
            <div className="flex items-baseline justify-between px-1 pb-2">
              <span className="text-sm font-semibold text-gray-800">{lane.label}</span>
              <span className="font-mono text-xs text-gray-500">{lane.count}{lane.valueCents > 0 ? ` · ${money(lane.valueCents)}` : ""}</span>
            </div>
            {lane.cards.length === 0 && <p className="px-1 py-3 text-xs text-gray-400">Nobody here</p>}
            <div className="space-y-2">
              {lane.cards.map((c) => <Card key={c.key} c={c} now={now} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Card({ c, now }: { c: PipelineCard; now: Date }) {
  return (
    <div className={`relative rounded-md border border-gray-200 border-l-4 bg-white p-2.5 text-sm shadow-sm ${c.temperature ? BORDER[c.temperature] : "border-l-gray-200"}`}
      data-testid={`pipeline-card-${c.key}`} data-temperature={c.temperature ?? "none"}>
      <Link href={c.href} className="block pr-6">
        <span className="block truncate font-medium text-gray-900">{c.name}</span>
        {c.address && <span className="block truncate text-xs text-gray-500">{c.address}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <BrandPill brand={c.brand} always />
          {c.jobType && <span className="text-[11px] capitalize text-gray-500">{c.jobType}</span>}
        </span>
        <span className="mt-1.5 flex items-baseline justify-between">
          <b className="tabular-nums">{c.valueCents ? `${c.valueIsGuess ? "about " : ""}${money(c.valueCents)}` : "—"}</b>
          <span className="font-mono text-[11px] text-gray-500" title={c.stage.because}>{stageAge(c.stage.since, now)}{c.stage.idle ? " · idle" : ""}</span>
        </span>
        <span className="mt-1 block truncate text-[11px] text-gray-500">{c.stage.because}</span>
        {(c.viewCount > 0 || c.cameBack > 0) && (
          <span className="mt-1 flex flex-wrap gap-1">
            {c.viewCount > 0 && <i className="rounded-full border border-cyan-300 px-1.5 text-[10px] font-semibold not-italic text-cyan-800" data-testid={`pipeline-viewed-${c.key}`}>Viewed {c.viewCount}×</i>}
            {c.cameBack > 0 && <i className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold not-italic text-emerald-800">Came back ×{c.cameBack}</i>}
          </span>
        )}
        {/* Brief §4.2: last / next automation reads automation_runs, which the automations brief builds. */}
        <span className="mt-1 block text-[10px] text-gray-400">Last sent — · Next due —</span>
      </Link>
      {c.accountId && <CardMenu accountId={c.accountId} testId={`pipeline-menu-${c.key}`} />}
    </div>
  );
}
