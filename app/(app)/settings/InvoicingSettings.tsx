"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Invoicing settings — the ⚑11 entity header, the ⚑12 bank details and the
 * core money defaults. The invoice document, the customer page and the PDF
 * all read these at render time, so a change here flows straight onto every
 * invoice that hasn't been issued yet. Issued invoices and their PDFs are
 * locked and never change — that's the point of issuing.
 */

type Entity = { tradingName: string; brandSub: string; address: string; abn: string; legalLine: string };
type Bank = { accountName: string; bank: string; bsb: string; acc: string; referenceRule: string };
type Core = { depositPct: number; paymentTermsDays: number; finalTermsDays: number };

const ENTITY_DEFAULTS: Entity = {
  tradingName: "Paint Group",
  brandSub: "Painting · Plastering · Restoration",
  address: "25/25-35 Bunney Road, Oakleigh South VIC 3167",
  abn: "41 639 780 108",
  legalLine: "",
};
const BANK_DEFAULTS: Bank = {
  accountName: "ENLVN Pty Ltd", bank: "Commonwealth Bank", bsb: "", acc: "", referenceRule: "invoice number",
};
const CORE_DEFAULTS: Core = { depositPct: 10, paymentTermsDays: 7, finalTermsDays: 7 };

export default function InvoicingSettings({
  initialEntity, initialBank, initialCore,
}: {
  initialEntity: Partial<Entity> | null;
  initialBank: Partial<Bank> | null;
  initialCore: Partial<Core> | null;
}) {
  const [entity, setEntity] = useState<Entity>({ ...ENTITY_DEFAULTS, ...(initialEntity ?? {}) });
  const [bank, setBank] = useState<Bank>({ ...BANK_DEFAULTS, ...(initialBank ?? {}) });
  const [core, setCore] = useState<Core>({ ...CORE_DEFAULTS, ...(initialCore ?? {}) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    const supabase = createClient();
    // The `invoicing` key carries more than the three numbers here — merge,
    // never replace, so the surcharge/numbering values survive a save.
    const { data: existing } = await supabase.from("settings").select("value").eq("key", "invoicing").maybeSingle();
    const merged = { ...((existing?.value as Record<string, unknown>) ?? {}), ...core };
    // ONE source of truth for banking: the estimate header reads
    // company_profile, the invoices read invoicing_bank — this save keeps
    // the two in lock-step so they can never disagree.
    const { data: profile } = await supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle();
    const profileValue = {
      ...((profile?.value as Record<string, unknown>) ?? {}),
      bankName: bank.accountName, bank: bank.bank, bsb: bank.bsb, acc: bank.acc,
    };
    const results = await Promise.all([
      supabase.from("settings").upsert({ key: "invoicing_entity", value: entity }, { onConflict: "key" }),
      supabase.from("settings").upsert({ key: "invoicing_bank", value: bank }, { onConflict: "key" }),
      supabase.from("settings").upsert({ key: "invoicing", value: merged }, { onConflict: "key" }),
      supabase.from("settings").upsert({ key: "company_profile", value: profileValue }, { onConflict: "key" }),
    ]);
    setSaving(false);
    const error = results.find((r) => r.error)?.error;
    setMsg(error ? error.message : "Saved ✓ — new invoices and the customer page pick this up straight away.");
  }

  const field = (label: string, value: string, onChange: (v: string) => void, hint?: string) => {
    const id = "invset-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return (
      <div>
        <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      </div>
    );
  };

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-gray-500">
        These details appear on every invoice, receipt and the customer&rsquo;s payment page.
        Invoices already issued keep the details they were issued with — corrections there are
        void-and-reissue, never an edit.
      </p>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Business identity</h3>
        {field("Trading name", entity.tradingName, (v) => setEntity({ ...entity, tradingName: v }))}
        {field("Tagline", entity.brandSub, (v) => setEntity({ ...entity, brandSub: v }))}
        {field("Address", entity.address, (v) => setEntity({ ...entity, address: v }))}
        {field("ABN", entity.abn, (v) => setEntity({ ...entity, abn: v }))}
        {field("Legal entity line (optional)", entity.legalLine, (v) => setEntity({ ...entity, legalLine: v }),
          "Shown under the address when set — pending the accountant's ruling on ENLVN Pty Ltd.")}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Bank details — shown in the &ldquo;How to pay&rdquo; box</h3>
        {field("Account name", bank.accountName, (v) => setBank({ ...bank, accountName: v }))}
        {field("Bank", bank.bank, (v) => setBank({ ...bank, bank: v }))}
        <div className="grid grid-cols-2 gap-3">
          {field("BSB", bank.bsb, (v) => setBank({ ...bank, bsb: v }))}
          {field("Account number", bank.acc, (v) => setBank({ ...bank, acc: v }))}
        </div>
        <p className="text-xs text-gray-400">Customers are asked to use the invoice number as the payment reference.</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Money defaults</h3>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Deposit %</label>
            <input type="number" min={0} max={100} value={core.depositPct}
              onChange={(e) => setCore({ ...core, depositPct: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Payment terms (days)</label>
            <input type="number" min={0} max={90} value={core.paymentTermsDays}
              onChange={(e) => setCore({ ...core, paymentTermsDays: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Final invoice terms (days)</label>
            <input type="number" min={0} max={90} value={core.finalTermsDays}
              onChange={(e) => setCore({ ...core, finalTermsDays: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          The deposit % seeds NEW estimates (each estimate can still set its own); terms set the due
          date at issue.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save invoicing settings"}
        </button>
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>
    </div>
  );
}
