"use client";

import { useRef, useState, useTransition } from "react";
import { requestAgreementAction, uploadAgreementAction } from "../actions";
import { agreementGateWord, dmy, type AgreementStatus } from "@/lib/agreements/status";

/**
 * A contractor's subcontractor agreement on their record (agreement brief
 * §7): the line, the gate word, Download for the signed copy, Request
 * signature (text + email with the portal link; starts the grace window for
 * an existing contractor), the earlier copies, and Add signed agreement —
 * the office uploads a scanned paper copy with the date it was signed, which
 * lands in the same row shape (source = uploaded) and shows to the painter
 * at once.
 */
export default function ContractorAgreement({ contractorId, status, line, pdfUrl, today }: {
  contractorId: string; status: AgreementStatus | null; line: string; pdfUrl: string | null; today: string;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => {
    setMsg(null);
    const r = await fn().catch(() => ({ ok: false, message: "That did not work — try again." }));
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) form.current?.reset();
  });
  if (!status) return <p className="mt-2 text-sm text-gray-500" data-testid="agreement-unavailable">The agreement is not switched on yet (migration 20270285).</p>;
  const signed = status.signed;
  const gateOpen = status.gate !== "ok";
  const tone = signed && !gateOpen ? "bg-emerald-100 text-emerald-800" : gateOpen ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800";
  const canRequest = !signed || status.gate === "agreement_expired";
  return (
    <div className="mt-2 space-y-3 text-sm" data-testid="agreement-card" data-gate={status.gate} data-signed={!!signed} data-kind={status.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`} data-testid="agreement-line">{line}</span>
        {gateOpen && <span className="text-xs text-red-700" data-testid="agreement-gate">{agreementGateWord(status.gate)} · no job offers</span>}
        {status.kind === "existing" && !signed && !status.requestedAt && <span className="text-xs text-gray-500">On the books before the portal agreement — offers keep flowing until you ask them to sign.</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50" data-testid="agreement-download">Download signed copy</a>}
        {signed && !pdfUrl && <span className="text-xs text-gray-500" data-testid="agreement-pdf-pending">PDF being prepared</span>}
        {canRequest && (
          <button type="button" disabled={pending} onClick={() => run(() => requestAgreementAction({ id: contractorId }))}
            className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50" data-testid="agreement-request">
            {pending ? "Sending…" : status.requestedAt ? "Request signature again" : "Request signature"}
          </button>
        )}
      </div>
      {signed && (
        <p className="text-xs text-gray-500" data-testid="agreement-signed-detail">
          {signed.source === "uploaded" ? "Signed on paper" : `Signed in the portal by ${signed.signedName}`}{signed.version ? ` · Version ${signed.version}` : " · version not recorded"}
          {signed.commencementOn ? ` · runs ${dmy(signed.commencementOn)}` : ""}{signed.expiresOn ? ` to ${dmy(signed.expiresOn)}` : ""}
        </p>
      )}
      {status.history.filter((h) => h.id !== signed?.id).length > 0 && (
        <ul className="text-xs text-gray-500" data-testid="agreement-history">
          {status.history.filter((h) => h.id !== signed?.id).map((h) => (
            <li key={h.id}>Earlier: {h.source === "uploaded" ? "paper copy" : `Version ${h.version}`} signed {dmy(h.signedAt)}{h.expiresOn ? `, expired ${dmy(h.expiresOn)}` : ""}</li>
          ))}
        </ul>
      )}

      <form ref={form} className="rounded-md border border-gray-200 bg-gray-50 p-3" data-testid="agreement-upload-form"
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => uploadAgreementAction(fd)); }}>
        <p className="text-xs font-medium text-gray-700">Add a signed agreement (paper copy)</p>
        <p className="mt-0.5 text-xs text-gray-500">For a contractor who signed on paper: the scan (PDF or photo) and the date they signed. It supersedes anything on file and shows in their Documents at once.</p>
        <input type="hidden" name="contractorId" value={contractorId} />
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">Date signed
            <input type="date" name="signedOn" required max={today} defaultValue={today} className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm" data-testid="agreement-upload-date" />
          </label>
          <label className="text-xs text-gray-600">Version
            <select name="version" className="mt-0.5 block rounded-md border border-gray-300 px-2 py-1 text-sm" defaultValue={status.currentVersion ? String(status.currentVersion) : ""} data-testid="agreement-upload-version">
              {status.currentVersion && <option value={String(status.currentVersion)}>Version {status.currentVersion}</option>}
              <option value="">Pre-portal (version not recorded)</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">File
            <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="mt-0.5 block text-sm" data-testid="agreement-upload-file" />
          </label>
          <button type="submit" disabled={pending} className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50" data-testid="agreement-upload">
            {pending ? "Uploading…" : "Add signed agreement"}
          </button>
        </div>
      </form>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`} role="status" data-testid="agreement-msg">{msg.text}</p>}
    </div>
  );
}
