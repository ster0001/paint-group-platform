"use client";

import { useState, useTransition } from "react";
import { revealContractorBankAction } from "../actions";

/**
 * Bank details on the painter's page (Tom, 7 Oct 2026): masked until the office
 * clicks Reveal, then the full BSB and account number, with Hide to mask them
 * again. The server renders only the last four digits; the decrypted number
 * arrives on the click and is never written anywhere on the client.
 */
export default function ContractorBank({ id, bsb, last4 }: { id: string; bsb: string | null; last4: string | null }) {
  const [full, setFull] = useState<{ bsb: string; account: string } | null>(null);
  const [err, setErr] = useState("");
  const [pending, startTransition] = useTransition();

  if (!last4) return <span className="text-gray-400">not on file</span>;

  const reveal = () => {
    setErr("");
    startTransition(async () => {
      const r = await revealContractorBankAction({ id }).catch(() => ({ ok: false as const, message: "That didn't work — try again." }));
      if (r.ok) setFull({ bsb: r.bsb, account: r.account }); else setErr(r.message);
    });
  };

  return (
    <span className="flex flex-col items-end gap-0.5" data-testid="bank-row">
      {full ? (
        <span className="flex items-center gap-2">
          <span className="font-mono" data-testid="bank-full">BSB {full.bsb || "—"} · Acc {full.account || "—"}</span>
          <button type="button" onClick={() => setFull(null)} className="text-xs text-gray-500 underline hover:text-gray-800" data-testid="bank-hide">Hide</button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <button type="button" onClick={reveal} disabled={pending} title="Show the full account number"
            className="font-mono text-sky-700 hover:underline disabled:opacity-50" data-testid="bank-reveal">
            {bsb ?? "—"} · ···· {last4}{pending ? " …" : ""}
          </button>
          <span className="text-xs text-gray-400">click to reveal</span>
        </span>
      )}
      {err && <span className="text-xs text-red-700" data-testid="bank-err">{err}</span>}
    </span>
  );
}
