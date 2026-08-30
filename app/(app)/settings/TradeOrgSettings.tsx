"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Trade portal v2 · Session 5 — the per-account approval & terms fields
 * (Tom's rulings ⚑1/⚑3/⚑5, 31 Aug), edited office-side under staff RLS:
 * org kind, approve-on-behalf-of-the-owner (default follows the kind),
 * the owner-referral threshold, payment terms, and the PO-to-invoice gate.
 */

type OrgFields = {
  org_kind: string | null;
  can_approve_for_owner: boolean | null;
  owner_referral_threshold_cents: number | null;
  payment_terms_days: number | null;
  po_required_to_invoice: boolean | null;
};

const KINDS = ["real_estate", "facilities", "insurance", "builder", "body_corporate", "other"] as const;
const tri = (v: boolean | null) => (v === null ? "default" : v ? "yes" : "no");
const unTri = (v: string): boolean | null => (v === "default" ? null : v === "yes");

export default function TradeOrgSettings({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<OrgFields | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open || f) return;
    createClient().from("accounts")
      .select("org_kind, can_approve_for_owner, owner_referral_threshold_cents, payment_terms_days, po_required_to_invoice")
      .eq("id", accountId).maybeSingle()
      .then(({ data }) => { if (data) setF(data as OrgFields); });
  }, [open, f, accountId]);

  const save = async (patch: Partial<OrgFields>) => {
    setMsg("");
    const next = { ...(f as OrgFields), ...patch };
    setF(next);
    const { error } = await createClient().from("accounts").update(patch).eq("id", accountId);
    setMsg(error ? `Couldn't save: ${error.message}` : "Saved ✓");
  };

  if (!open) {
    return (
      <button className="text-xs text-gray-500 hover:underline" onClick={() => setOpen(true)}>
        Approvals &amp; terms
      </button>
    );
  }
  if (!f) return <span className="text-xs text-gray-400">Loading…</span>;

  return (
    <div className="mt-2 w-full space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2">Org kind
          <select className="rounded border border-gray-300 px-2 py-1" value={f.org_kind ?? ""}
            onChange={(e) => save({ org_kind: e.target.value || null })}>
            <option value="">—</option>
            {KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2" title="Default follows the org kind: real estate yes, others no">
          Approve for the owner
          <select className="rounded border border-gray-300 px-2 py-1" value={tri(f.can_approve_for_owner)}
            onChange={(e) => save({ can_approve_for_owner: unTri(e.target.value) })}>
            <option value="default">Default</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2" title="Above this inc-GST total, only Send to owner is offered">
          Owner referral over $
          <input className="w-24 rounded border border-gray-300 px-2 py-1" type="number" min={0}
            defaultValue={f.owner_referral_threshold_cents != null ? f.owner_referral_threshold_cents / 100 : ""}
            onBlur={(e) => save({ owner_referral_threshold_cents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} />
        </label>
        <label className="flex items-center justify-between gap-2" title="Blank = the Settings default (14)">
          Payment terms (days)
          <input className="w-16 rounded border border-gray-300 px-2 py-1" type="number" min={1} max={90}
            defaultValue={f.payment_terms_days ?? ""}
            onBlur={(e) => save({ payment_terms_days: e.target.value === "" ? null : Number(e.target.value) })} />
        </label>
        <label className="flex items-center justify-between gap-2" title="Default follows the org kind: facilities yes, others no">
          PO required to invoice
          <select className="rounded border border-gray-300 px-2 py-1" value={tri(f.po_required_to_invoice)}
            onChange={(e) => save({ po_required_to_invoice: unTri(e.target.value) })}>
            <option value="default">Default</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-gray-500">{msg}</span>
        <button className="text-gray-500 hover:underline" onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
}
