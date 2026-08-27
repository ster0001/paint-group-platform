"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Settings → Documents (3a-5, ⚑13): the credentials every customer portal
 * displays — upload once with an expiry date, the portals always serve the
 * current version, and an expiring certificate flags amber in the PC console.
 * Plus the warranty-terms approval switch: the portal renders the terms with
 * a DRAFT watermark until they're marked legally approved here.
 */

export type CompanyDocRow = {
  id: string;
  title: string;
  kind: string;
  storage_path: string;
  expires_on: string | null;
  active: boolean;
};

const KINDS = [
  { value: "insurance", label: "Insurance certificate" },
  { value: "certificate", label: "Certificate" },
  { value: "licence", label: "Licence" },
  { value: "other", label: "Other" },
];

export default function DocumentsManager({
  initialDocs,
  warrantyApproved,
}: {
  initialDocs: CompanyDocRow[];
  warrantyApproved: boolean;
}) {
  const [docs, setDocs] = useState(initialDocs);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("insurance");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [approved, setApproved] = useState(warrantyApproved);
  // Captured once — render must stay pure (react-hooks/purity).
  const [now] = useState(() => Date.now());

  const upload = async () => {
    if (!file || !title.trim()) { setMsg("A title and a file, please."); return; }
    setBusy(true); setMsg("");
    const supabase = createClient();
    const path = `docs/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    const up = await supabase.storage.from("company-docs").upload(path, file, { contentType: file.type });
    if (up.error) { setMsg(`Upload failed: ${up.error.message}`); setBusy(false); return; }
    const { data, error } = await supabase.from("company_documents")
      .insert({ title: title.trim(), kind, storage_path: path, expires_on: expires || null })
      .select("id, title, kind, storage_path, expires_on, active").single();
    if (error) { setMsg(`Save failed: ${error.message}`); setBusy(false); return; }
    setDocs((d) => [data as CompanyDocRow, ...d]);
    setTitle(""); setExpires(""); setFile(null); setBusy(false);
    setMsg("Uploaded — it's on display in every portal now.");
  };

  const setActive = async (row: CompanyDocRow, active: boolean) => {
    const { error } = await createClient().from("company_documents").update({ active }).eq("id", row.id);
    if (!error) setDocs((d) => d.map((x) => (x.id === row.id ? { ...x, active } : x)));
  };

  const setExpiry = async (row: CompanyDocRow, expires_on: string) => {
    const { error } = await createClient().from("company_documents")
      .update({ expires_on: expires_on || null }).eq("id", row.id);
    if (!error) setDocs((d) => d.map((x) => (x.id === row.id ? { ...x, expires_on: expires_on || null } : x)));
  };

  const remove = async (row: CompanyDocRow) => {
    if (!window.confirm(`Remove "${row.title}" from display and delete the file?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("company_documents").delete().eq("id", row.id);
    if (error) { setMsg(`Couldn't remove: ${error.message}`); return; }
    await supabase.storage.from("company-docs").remove([row.storage_path]);
    setDocs((d) => d.filter((x) => x.id !== row.id));
  };

  const saveApproved = async (value: boolean) => {
    setApproved(value);
    await createClient().from("settings").upsert(
      { key: "warranty_terms", value: { approved: value, approvedAt: value ? new Date().toISOString() : null } },
      { onConflict: "key" },
    );
  };

  const expiryTone = (d: CompanyDocRow) => {
    if (!d.expires_on) return "text-gray-500";
    const days = Math.floor((Date.parse(d.expires_on) - now) / 86_400_000);
    return days < 0 ? "text-red-600 font-semibold" : days <= 30 ? "text-amber-600 font-semibold" : "text-gray-500";
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="text-sm font-medium">Add a document</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Title — e.g. Public liability certificate of currency ($20M)"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <label className="text-sm text-gray-600">Expires on
            <input type="date" className="ml-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <input type="file" accept="application/pdf,image/*" className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <button className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accentink disabled:opacity-50"
          disabled={busy} onClick={upload}>
          {busy ? "Uploading…" : "Upload & display"}
        </button>
        {msg && <div className="mt-2 text-sm text-gray-600">{msg}</div>}
      </div>

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {docs.length === 0 && <li className="p-4 text-sm text-gray-400">Nothing on display yet — the public liability certificate belongs here first.</li>}
        {docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
            <span className="text-gray-400">{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</span>
            <label className={expiryTone(d)}>
              expires
              <input type="date" className="ml-1 rounded border border-gray-200 px-2 py-1"
                defaultValue={d.expires_on ?? ""} onBlur={(e) => setExpiry(d, e.target.value)} />
            </label>
            <label className="flex items-center gap-1 text-gray-600">
              <input type="checkbox" checked={d.active} onChange={(e) => setActive(d, e.target.checked)} /> shown
            </label>
            <button className="text-red-600 hover:underline" onClick={() => remove(d)}>Remove</button>
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={approved} onChange={(e) => saveApproved(e.target.checked)} className="mt-0.5" />
          <span>
            <b>Warranty terms legally approved.</b> Until ticked, the portal shows the 2-year warranty
            terms with a DRAFT watermark. Tick only once the lawyer has reviewed them
            (docs/briefs/paint-group-workmanship-warranty.md).
          </span>
        </label>
      </div>
    </div>
  );
}
