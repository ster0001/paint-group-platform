"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptAttr, checkUpload } from "@/lib/uploads/validate";
import type { CompanyProfile } from "@/app/quote/company";

export default function SettingsForm({ initial }: { initial: CompanyProfile }) {
  const [c, setC] = useState<CompanyProfile>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k: keyof CompanyProfile, v: string) => setC((x) => ({ ...x, [k]: v }));

  // Upload a logo to the shared public estimate-media bucket and store its URL.
  // Remember to click Save to keep it — like every other field here.
  async function uploadLogo(file: File | null | undefined, which: "logoUrl" | "logoUrlLight" = "logoUrl") {
    if (!file) return;
    const bad = checkUpload(file, "image");
    if (bad) { setMsg(bad); return; }
    setUploading(true);
    setMsg("");
    const supabase = createClient();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `logos/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("estimate-media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("estimate-media").getPublicUrl(path);
      set(which, data.publicUrl);
      setMsg("Logo uploaded — click Save to keep it.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

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
      </div>

      {/* Logo — shown top-left on every estimate. Upload or replace here. */}
      <div className="mt-3">
        <span className="text-xs text-gray-500">Logo</span>
        <div className="mt-1 flex items-center gap-3 rounded-md border border-gray-200 p-3">
          <div className="flex h-14 w-40 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-900">
            {c.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.logoUrl} alt="Logo" className="max-h-12 max-w-full object-contain" />
              : <span className="text-[10px] tracking-widest text-gray-400">NO LOGO</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
              {uploading ? "Uploading…" : c.logoUrl ? "Replace logo" : "Upload logo"}
              <input type="file" accept={acceptAttr("image")} className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0], "logoUrl")} />
            </label>
            {c.logoUrl && (
              <button onClick={() => set("logoUrl", "")} className="w-fit text-xs text-gray-400 hover:text-red-600">Remove</button>
            )}
            <span className="text-[11px] text-gray-400">PNG with transparent background works best. Shown on a dark header.</span>
          </div>
        </div>
      </div>

      {/* Secondary logo — for LIGHT backgrounds: email and the quote PDF. */}
      <div className="mt-3">
        <span className="text-xs text-gray-500">Logo for light backgrounds</span>
        <div className="mt-1 flex items-center gap-3 rounded-md border border-gray-200 p-3">
          <div className="flex h-14 w-40 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white">
            {c.logoUrlLight
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.logoUrlLight} alt="Light-background logo" className="max-h-12 max-w-full object-contain" />
              : <span className="text-[10px] tracking-widest text-gray-300">FALLS BACK TO MAIN</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
              {uploading ? "Uploading…" : c.logoUrlLight ? "Replace" : "Upload light logo"}
              <input type="file" accept={acceptAttr("image")} className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0], "logoUrlLight")} />
            </label>
            {c.logoUrlLight && (
              <button onClick={() => set("logoUrlLight", "")} className="w-fit text-xs text-gray-400 hover:text-red-600">Remove</button>
            )}
            <span className="text-[11px] text-gray-400">Used on emails and the quote PDF (white background). If empty, the main logo is used.</span>
          </div>
        </div>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Estimator</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {field("estimatorName", "Name")}
        {field("estimatorTitle", "Title")}
        {field("estimatorPhone", "Phone")}
        {field("email", "Email")}
      </div>

      <h3 className="mt-5 text-sm font-semibold">Project coordinator</h3>
      <p className="mt-1 text-xs text-gray-500">
        Named on the customer dashboard as who manages and oversees the job, with a Message me button.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {field("coordinatorName", "Name")}
      </div>

      {/* Banking moved to the Invoicing folder (24 Aug 2026) — one editor,
          one source of truth. Its save writes BOTH company_profile (the
          estimate header) and invoicing_bank (invoices, receipts, the
          customer payment page), so the documents can never disagree. */}
      <h3 className="mt-5 text-sm font-semibold">Banking</h3>
      <p className="mt-1 text-xs text-gray-400">
        Bank details are edited in the <b>Invoicing</b> folder below — one place, and every
        document (estimates, invoices, receipts, the customer payment page) stays in step.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
