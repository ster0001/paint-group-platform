"use client";

import { useState, useTransition } from "react";
import { bonusDecideAction, bonusHandOverAction, clearRedAction } from "../actions";

/**
 * Painter status Step 7 — the office side of the colour (R11, R12, ⚑8, ⚑13):
 * the colour and its line; the Red clearance (owner only, with a reason); the
 * bonus reviews — "Tell Tom" for the PC, the amount + Approve / Decline for the
 * owner (approve refuses while the Settings switch is off). Amounts are shown
 * here because this page is owner / admin / PC only (RLS says the same).
 */
export type BonusRow = {
  id: string; status: "due" | "with_owner" | "approved" | "declined" | "paid"; triggeredAt: string; handedOverAt: string | null;
  suggestedCents: number; amountCents: number | null; decidedAt: string | null; note: string; qualifyingChangedAt: string | null; qualifyingCount: number; paymentRef: string;
};
export type StatusRow = { colour: string; line: string; streak: number; bonusCounter: number; clearedAt: string | null; clearedReason: string; computedAt: string };

const COLOUR: Record<string, string> = { new: "New", green: "Green", yellow: "Yellow", orange: "Orange", red: "Red" };
const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }) : "");

export default function ContractorStatusPanel({ painterId, status, bonuses, isOwner, approvalsOn, employee }: {
  painterId: string; status: StatusRow | null; bonuses: BonusRow[]; isOwner: boolean; approvalsOn: boolean; employee: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    setMsg(null);
    const r = await fn().catch(() => ({ ok: false, message: "That didn't work — try again." }));
    setMsg({ ok: r.ok, text: r.message });
  });
  const blocked = status?.colour === "red" && !status.clearedAt;

  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="card-status">
      <h2 className="text-sm font-semibold">Status and bonus</h2>
      {!status ? (
        <p className="mt-2 text-sm text-gray-500" data-testid="status-none">{employee ? "No status yet — an employed painter is scored on the jobs they lead." : "No status yet — the evaluator has not run for them."}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3" data-testid="status-row" data-colour={status.colour}>
          <div>
            <p className="text-lg font-semibold" data-testid="status-colour">{COLOUR[status.colour] ?? status.colour}</p>
            <p className="text-sm text-gray-600">{status.line}</p>
            <p className="mt-1 text-xs text-gray-500">{status.streak} clean in a row{status.colour === "green" ? ` · bonus counter ${status.bonusCounter} of 4` : ""} · computed {when(status.computedAt)}</p>
          </div>
          {status.colour === "red" && (
            <div className="max-w-sm rounded-md border border-red-200 bg-red-50 p-3 text-sm" data-testid="red-block">
              {status.clearedAt ? (
                <p className="text-red-900" data-testid="red-cleared">Spoken with, offers allowed — {when(status.clearedAt)}. {status.clearedReason}</p>
              ) : (
                <>
                  <p className="font-medium text-red-900">No new offers until Tom records the conversation.</p>
                  {isOwner ? (
                    <>
                      <textarea className="mt-2 w-full rounded border border-red-200 p-2 text-sm" rows={2} placeholder="What was agreed" value={reason}
                        onChange={(e) => setReason(e.target.value)} data-testid="red-reason" />
                      <button type="button" disabled={pending || reason.trim().length < 3} className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                        onClick={() => run(() => clearRedAction({ id: painterId, reason }))} data-testid="red-clear">
                        Spoken with — offers allowed
                      </button>
                    </>
                  ) : <p className="mt-1 text-xs text-red-800">Only the owner can clear this.</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {blocked && <p className="sr-only">offers blocked</p>}

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Bonus reviews</h3>
      {bonuses.length === 0 ? (
        <p className="mt-1 text-sm text-gray-500" data-testid="bonus-none">None yet. One comes up every 4 clean jobs of 16 hours or more while on Green.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100" data-testid="bonus-list">
          {bonuses.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm" data-testid={`bonus-${b.id}`} data-status={b.status}>
              <div>
                <p className="font-medium">
                  {b.status === "due" ? "Due — waiting on the PC" : b.status === "with_owner" ? "With Tom" : b.status === "approved" ? `Approved ${money(b.amountCents ?? 0)}` : b.status === "paid" ? `Paid ${money(b.amountCents ?? 0)}` : "Declined"}
                  {b.qualifyingChangedAt && (b.status === "due" || b.status === "with_owner") && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900" data-testid={`bonus-changed-${b.id}`}>a qualifying job changed</span>}
                </p>
                <p className="text-xs text-gray-500">
                  Raised {when(b.triggeredAt)} · {b.qualifyingCount} qualifying jobs{b.handedOverAt ? ` · handed over ${when(b.handedOverAt)}` : ""}{b.decidedAt ? ` · decided ${when(b.decidedAt)}` : ""}
                  {b.status === "approved" && !employee ? (b.paymentRef ? " · claimed — on an invoice" : " · not claimed yet") : ""}
                  {b.status === "approved" && employee ? " · goes on the payroll CSV" : ""}
                  {b.note ? ` · ${b.note}` : ""}
                </p>
              </div>
              {(b.status === "due" || b.status === "with_owner") && (
                <div className="flex flex-wrap items-center gap-2">
                  {b.status === "due" && (
                    <button type="button" disabled={pending} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs"
                      onClick={() => run(() => bonusHandOverAction({ bonusId: b.id, painterId }))} data-testid={`bonus-handover-${b.id}`}>Tell Tom</button>
                  )}
                  {isOwner && (
                    <>
                      <label className="flex items-center gap-1 text-xs">$
                        <input type="number" min={0} step="0.01" className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" data-testid={`bonus-amount-${b.id}`}
                          value={amounts[b.id] ?? (b.suggestedCents / 100).toFixed(2)} onChange={(e) => setAmounts({ ...amounts, [b.id]: e.target.value })} />
                      </label>
                      <button type="button" disabled={pending || !approvalsOn} title={approvalsOn ? "" : "Bonus approvals are switched off until the GST and payroll questions are settled"}
                        className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40" data-testid={`bonus-approve-${b.id}`}
                        onClick={() => run(() => bonusDecideAction({ bonusId: b.id, painterId, approve: true, amount: Number(amounts[b.id] ?? (b.suggestedCents / 100).toFixed(2)) }))}>Approve</button>
                      <button type="button" disabled={pending} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs" data-testid={`bonus-decline-${b.id}`}
                        onClick={() => run(() => bonusDecideAction({ bonusId: b.id, painterId, approve: false }))}>Decline</button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!approvalsOn && isOwner && bonuses.some((b) => b.status === "due" || b.status === "with_owner") && (
        <p className="mt-2 text-xs text-amber-800" data-testid="bonus-approvals-off">Approve is off until the GST (⚑10) and payroll (⚑11) questions are settled — `painter_status_rules.bonusApprovalsEnabled`.</p>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="status-msg">{msg.text}</p>}
    </section>
  );
}
