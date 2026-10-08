"use client";

import { useState, useTransition } from "react";
import { inviteStandardsAction, remindStandardsAction } from "../actions";

/**
 * The painter's standing with the finish standards (Step 2, ruling S7): the
 * confirmed date and version, or how long they have been invited and what
 * that means for offers — with the office's two buttons: Send standards
 * invite (message 1, starts the grace period) and Send reminder text
 * (message 2). Both go through the one dispatcher and land on the record.
 */
export default function ContractorStandards({ id, status, line }: { id: string; status: string; line: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    setMsg(null);
    const r = await fn().catch(() => ({ ok: false, message: "That didn't work — try again." }));
    setMsg({ ok: r.ok, text: r.message });
  });
  const tone = status === "confirmed" ? "bg-emerald-100 text-emerald-800" : status === "blocked" ? "bg-red-100 text-red-800" : status === "not_required" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-800";
  return (
    <span className="flex flex-col items-end gap-1" data-testid="standards-row" data-status={status}>
      <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`} data-testid="standards-line">{line}</span>
      {status !== "confirmed" && status !== "not_required" && (
        <span className="flex items-center gap-2">
          {(status === "not_invited" || status === "employee_unsigned") && (
            <button type="button" disabled={pending} onClick={() => run(() => inviteStandardsAction({ id }))}
              className="text-xs text-gray-700 underline hover:text-gray-900" data-testid="standards-invite">
              {status === "employee_unsigned" && line.includes("invited") ? "Invite again" : "Send standards invite"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => run(() => remindStandardsAction({ id }))}
            className="text-xs text-gray-700 underline hover:text-gray-900" data-testid="standards-remind">
            Send reminder text
          </button>
        </span>
      )}
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`} data-testid="standards-msg">{msg.text}</span>}
    </span>
  );
}
