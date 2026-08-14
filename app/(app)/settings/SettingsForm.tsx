"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CompanyProfile } from "@/app/quote/company";

export default function SettingsForm({ initial }: { initial: CompanyProfile }) {
  const [c, setC] = useState<CompanyProfile>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k: keyof CompanyProfile, v: string) => setC((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert({ key: "company_profile", value: c }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
  }

  const field = (k: keyof CompanyProfile, label: string) => (
    <label key={k} className="block text-xs">
      <span className="text-gray-500">{label}</span>
      <input value={c[k]} onChange={(e) => set(k, e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
    </label>
  );

  return (
    <div className="mt-4 max-w-2xl rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Company details</h2>
      <p className="mt-1 text-sm text-gray-500">These appear on the header of every estimate.</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {field("name", "Company name")}
        {field("abn", "ABN")}
        {field("addressLine1", "Address line 1")}
        {field("addressLine2", "Address line 2")}
        {field("phone", "Phone")}
        {field("logoUrl", "Logo URL")}
      </div>

      <h3 className="mt-5 text-sm font-semibold">Estimator</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {field("estimatorName", "Name")}
        {field("estimatorTitle", "Title")}
        {field("estimatorPhone", "Phone")}
        {field("email", "Email")}
      </div>

      <h3 className="mt-5 text-sm font-semibold">Banking</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {field("bankName", "Account name")}
        {field("bank", "Bank")}
        {field("bsb", "BSB")}
        {field("acc", "Account number")}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
