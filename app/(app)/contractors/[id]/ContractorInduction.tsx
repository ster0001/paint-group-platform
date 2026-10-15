"use client";

import { useState, useTransition } from "react";
import { inviteInductionAction, recordInductionCheckAction, setInductionKindAction } from "../actions";
import { CHECK_TASKS, gateWord, staffInductionLine, type InductionStatus } from "@/lib/induction/status";

/**
 * A painter's induction on their record (Step 5): the kind (full or
 * refresher), how many modules are ticked, the completion date, the gate
 * word, the practical check as one button pair per task (⚑5, ⚑17 — recorded
 * by staff only), the refresher invite, and the kind switch. For a worker
 * login (`worker` = true) the same block sits under the crew list with the
 * three-task check and the inducted date.
 */
export default function ContractorInduction({ profileId, status, worker = false, contractorId }: {
  profileId: string; status: InductionStatus | null; worker?: boolean; contractorId: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    setMsg(null);
    const r = await fn().catch(() => ({ ok: false, message: "That did not work — try again." }));
    setMsg({ ok: r.ok, text: r.message });
  });
  if (!status) return <span className="text-xs text-gray-400" data-testid="induction-row">Induction not available (migration 20270270)</span>;
  const now = new Date();
  const tone = status.complete && (status.kind === "refresher" || status.checkPassed) ? "bg-emerald-100 text-emerald-800"
    : status.gate === "induction_incomplete" || status.gate === "check_not_passed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  const tasks = CHECK_TASKS[status.kind];
  const result = (task: string) => status.tasks.find((t) => t.task === task)?.result ?? null;
  return (
    <span className="flex flex-col items-end gap-1" data-testid={worker ? `worker-induction-${profileId}` : "induction-row"} data-kind={status.kind} data-complete={status.complete} data-gate={status.gate ?? ""}>
      <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`} data-testid={worker ? `worker-induction-line-${profileId}` : "induction-line"}>
        {staffInductionLine(status, now)}{status.language ? ` · ${status.language}` : ""}
      </span>
      {worker && status.inductedAt && <span className="text-xs text-emerald-700" data-testid={`worker-inducted-${profileId}`}>Inducted · can be put on a job</span>}
      {status.gate && status.gate !== "ok" && <span className="text-xs text-red-700">{gateWord(status.gate)}</span>}
      {tasks.length > 0 && (
        <span className="mt-1 flex flex-col items-end gap-0.5" data-testid={worker ? `worker-check-${profileId}` : "induction-check"}>
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Practical check{status.checkPassed ? " · passed" : ""}</span>
          {tasks.map((t) => {
            const r = result(t.key);
            return (
              <span key={t.key} className="flex items-center gap-2 text-xs" data-testid={`check-task-${profileId}-${t.key}`} data-result={r ?? ""}>
                <span className={r === "pass" ? "text-emerald-700" : r === "not_yet" ? "text-amber-700" : "text-gray-600"}>{t.label}{r === "pass" ? " ✓" : r === "not_yet" ? " · not yet" : ""}</span>
                <button type="button" disabled={pending} onClick={() => run(() => recordInductionCheckAction({ contractorId, profileId, task: t.key, result: "pass" }))}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-50" data-testid={`check-pass-${profileId}-${t.key}`}>Pass</button>
                <button type="button" disabled={pending} onClick={() => run(() => recordInductionCheckAction({ contractorId, profileId, task: t.key, result: "not_yet" }))}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-50" data-testid={`check-notyet-${profileId}-${t.key}`}>Not yet</button>
              </span>
            );
          })}
        </span>
      )}
      {!worker && (
        <span className="flex items-center gap-2">
          {status.kind === "refresher" && !status.complete && (
            <button type="button" disabled={pending} onClick={() => run(() => inviteInductionAction({ id: contractorId }))}
              className="text-xs text-gray-700 underline hover:text-gray-900" data-testid="induction-invite">
              {status.invitedAt ? "Invite to the refresher again" : "Invite to the refresher"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => run(() => setInductionKindAction({ id: contractorId, kind: status.kind === "refresher" ? "full" : "refresher" }))}
            className="text-xs text-gray-500 underline hover:text-gray-900" data-testid="induction-switch-kind">
            {status.kind === "refresher" ? "Switch to the full induction" : "Switch to the refresher"}
          </button>
        </span>
      )}
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`} data-testid={worker ? `worker-induction-msg-${profileId}` : "induction-msg"}>{msg.text}</span>}
    </span>
  );
}
