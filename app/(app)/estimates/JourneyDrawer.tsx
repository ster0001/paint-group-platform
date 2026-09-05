"use client";

import { useEffect } from "react";
import { bucketPill, fmtActive, journeySteps, journeyWho, type WizardJourney } from "@/lib/wizard/journey";

const OUTCOME_LABEL: Record<WizardJourney["outcome"], string> = {
  none: "Nothing asked",
  call_requested: "Requested a call",
  visit_requested: "Requested a site visit",
  question_asked: "Asked to talk to a person",
  help_requested: "Asked us to call — stuck",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Buckets brief §5 — the Journey: every page with its time, the outcome,
 * the question text if any, and the entry source. Read-only.
 */
export default function JourneyDrawer({ j, onClose }: { j: WizardJourney; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const pill = bucketPill(j.bucket, j.jobType, j.furthestPage);
  const steps = journeySteps(j);
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-40 bg-black/30" />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl" data-testid="journey-drawer">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Journey</div>
            <h2 className="mt-0.5 text-lg font-semibold">{journeyWho(j)}</h2>
            <div className="text-sm text-gray-500">{[j.address || j.suburb, j.mode === "business" ? "Business" : j.mode === "home" ? "Home" : null, j.jobType].filter(Boolean).join(" · ")}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-800" aria-label="Close">×</button>
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 p-3 text-sm">
          <div className="flex items-center justify-between"><span className="text-gray-500">Status</span><b data-testid="journey-bucket">{pill.label}</b></div>
          <div className="mt-1 flex items-center justify-between"><span className="text-gray-500">Outcome</span><span>{OUTCOME_LABEL[j.outcome]}{j.outcomeAt ? ` · ${when(j.outcomeAt)}` : ""}</span></div>
          {j.outcomeNote && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900" data-testid="journey-question">&ldquo;{j.outcomeNote}&rdquo;</p>}
          <div className="mt-1 flex items-center justify-between"><span className="text-gray-500">Entry source</span><span className="font-mono text-xs">{j.entrySource ?? "not recorded"}</span></div>
          <div className="mt-1 flex items-center justify-between"><span className="text-gray-500">Started</span><span>{when(j.startedAt)}</span></div>
          <div className="mt-1 flex items-center justify-between"><span className="text-gray-500">Last active</span><span>{when(j.lastActiveAt)}</span></div>
          <div className="mt-1 flex items-center justify-between"><span className="text-gray-500">Time on the page</span><b data-testid="journey-active">{fmtActive(j.activeSeconds)}</b></div>
          {j.convertedAt && <div className="mt-1 flex items-center justify-between"><span className="text-gray-500">Saw the price</span><span>{when(j.convertedAt)}</span></div>}
        </div>

        <h3 className="mt-5 text-xs uppercase tracking-wide text-gray-400">Step by step</h3>
        <ol className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200" data-testid="journey-steps">
          {steps.map((s) => (
            <li key={s.page} className={`flex items-center justify-between px-3 py-2 text-sm ${s.reached ? "" : "text-gray-300"}`} data-reached={s.reached ? "1" : "0"}>
              <span className="flex items-center gap-2">
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${s.reached ? "bg-gray-900 text-white" : "bg-gray-100"}`}>{s.page}</span>
                {s.label}
                {s.current && !j.convertedAt && <span className="text-[10px] uppercase tracking-wide text-gray-400">here</span>}
              </span>
              <span className="font-mono text-xs" data-testid={`journey-step-${s.page}`}>{s.reached ? fmtActive(s.seconds) : "—"}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-gray-400">Time counts only while the tab was open and they were typing or scrolling.</p>
        <div className="mt-auto pt-6">
          {j.accountId && <a href={`/crm/customers/${j.accountId}`} className="text-sm font-medium text-gray-700 hover:underline">Open in the CRM →</a>}
        </div>
      </aside>
    </>
  );
}
