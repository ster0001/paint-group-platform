"use client";

import { bucketPill, journeyLine, type WizardJourney } from "@/lib/wizard/journey";

/** Shared with the estimates table, whose pills come from `estimatePill`. */
export const TONE: Record<string, string> = {
  emerald: "bg-emerald-600 text-white",
  amber: "bg-amber-500 text-white",
  "amber-outline": "border border-amber-500 text-amber-700",
  clay: "bg-[#b3574a] text-white",
  muted: "border border-gray-300 text-gray-500",
};

/** Buckets brief §5: the pill and the mono line beneath it. */
export default function WizardPill({ j, onOpen }: { j: WizardJourney; onOpen?: () => void }) {
  const pill = bucketPill(j.bucket, j.jobType, j.furthestPage);
  return (
    /* max-w-full + truncate: the mono line does not wrap, and in a table cell
       that made the column as wide as the longest session line on the page. */
    <button type="button" onClick={onOpen} className="group block max-w-full text-left" title="Open the journey" data-testid={`wizard-pill-${j.id}`} data-bucket={j.bucket}>
      <span className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[pill.tone]}`}>
        {j.bucket === "online_now" && <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />}
        {pill.label}
      </span>
      <span className="mt-1 block truncate font-mono text-[11px] text-gray-500 group-hover:text-gray-800" data-testid={`wizard-line-${j.id}`}>
        {journeyLine(j, new Date())}
      </span>
    </button>
  );
}
