"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ProductRow = {
  id?: string;
  name: string;
  type?: string | null;
  brand?: string | null;
  finish?: string | null;
  category?: string | null;
  internal_alias?: string | null;
  blurb?: string | null;
  properties?: string[] | null;
  guarantee?: string | null;
  product_url?: string | null;
  coverage_m2_per_l?: string | null;
  recoat?: string | null;
  customer_visible?: boolean | null;
  source_notes?: string | null;
  coverage?: number | null;
  price_per_litre?: number | null; // cents
  wastage_pct?: number | null;
  photo_url?: string | null;
  __new?: boolean;
  __localId?: number;
};

const CATEGORY_ORDER = [
  "Interior walls", "Ceilings", "Trim & doors", "Exterior walls",
  "Texture & membrane", "Prep & primers", "Clear & floors",
];
const SHEEN_LEVELS = ["Flat", "Matt", "Satin", "Low Sheen", "Semi Gloss", "Gloss", "High Gloss"];
// Default sheen by product type, applied by "Auto-set by type" (manual edits win).
function autoSheen(name: string, category: string | null | undefined): string | null {
  const n = (name || "").toLowerCase();
  const c = category || "";
  if (/undercoat/.test(n)) return "Flat";
  if (/cabothane/.test(n)) return "Semi Gloss";
  if (/ceiling/i.test(c) || /ceiling/i.test(n)) return "Flat";
  if (/walls/i.test(c)) return "Matt";
  if (/trim|door/i.test(c)) return "Semi Gloss";
  return null;
}
const inp = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";
let tmp = -1;

export default function ProductsManager({ initial }: { initial: ProductRow[] }) {
  const [rows, setRows] = useState<ProductRow[]>(() => initial.map((r) => ({ ...r, price_per_litre: r.price_per_litre != null ? r.price_per_litre / 100 : r.price_per_litre })));
  const [open, setOpen] = useState<string | number | null>(null);
  const [busy, setBusy] = useState<string | number | null>(null);
  const [uploading, setUploading] = useState<string | number | null>(null);
  const [msg, setMsg] = useState<Record<string | number, string>>({});

  const rid = (r: ProductRow) => (r.id ?? r.__localId) as string | number;
  const patch = (r: ProductRow, p: Partial<ProductRow>) => setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? { ...x, ...p } : x)));

  const groups = useMemo(() => {
    const m = new Map<string, ProductRow[]>();
    for (const r of rows) {
      const c = r.category || "Uncategorised";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(r);
    }
    const ordered = [...CATEGORY_ORDER.filter((c) => m.has(c)), ...[...m.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return ordered.map((c) => [c, m.get(c)!] as const);
  }, [rows]);

  async function uploadPhoto(r: ProductRow, file?: File | null) {
    if (!file) return;
    setUploading(rid(r));
    const supabase = createClient();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${rid(r)}-${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("product-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("product-photos").getPublicUrl(path);
      patch(r, { photo_url: data.publicUrl });
      setMsg((m) => ({ ...m, [rid(r)]: "Photo uploaded — Save to keep." }));
    } catch (e) {
      setMsg((m) => ({ ...m, [rid(r)]: e instanceof Error ? e.message : "Upload failed" }));
    } finally {
      setUploading(null);
    }
  }

  async function save(r: ProductRow) {
    setBusy(rid(r));
    setMsg((m) => ({ ...m, [rid(r)]: "" }));
    const supabase = createClient();
    const payload = {
      name: r.name?.trim(), type: r.type ?? null, brand: r.brand ?? null, finish: r.finish ?? null,
      category: r.category ?? null, internal_alias: r.internal_alias ?? null, blurb: r.blurb ?? null,
      properties: (r.properties ?? []).filter(Boolean), guarantee: r.guarantee ?? null,
      product_url: r.product_url ?? null, coverage_m2_per_l: r.coverage_m2_per_l ?? null, recoat: r.recoat ?? null,
      customer_visible: !!r.customer_visible, coverage: r.coverage ?? null,
      price_per_litre: r.price_per_litre === null || r.price_per_litre === undefined || (r.price_per_litre as unknown as string) === "" ? null : Math.round(Number(r.price_per_litre) * 100),
      wastage_pct: r.wastage_pct ?? null, photo_url: r.photo_url ?? null,
    };
    try {
      if (r.__new) {
        const { data, error } = await supabase.from("products").insert(payload).select("id").single();
        if (error) throw error;
        patch(r, { id: data.id, __new: false });
      } else {
        const { error } = await supabase.from("products").update(payload).eq("id", r.id!);
        if (error) throw error;
      }
      setMsg((m) => ({ ...m, [rid(r)]: "Saved ✓" }));
    } catch (e) {
      setMsg((m) => ({ ...m, [rid(r)]: e instanceof Error ? e.message : "Save failed" }));
    } finally {
      setBusy(null);
    }
  }

  // Persist a single column immediately (used by the inline sheen dropdown).
  async function saveField(r: ProductRow, field: keyof ProductRow, value: unknown) {
    patch(r, { [field]: value } as Partial<ProductRow>);
    if (r.__new) return; // new rows persist on the full Save
    const supabase = createClient();
    const { error } = await supabase.from("products").update({ [field]: value }).eq("id", r.id!);
    setMsg((m) => ({ ...m, [rid(r)]: error ? error.message : "Saved ✓" }));
  }

  // Apply the default sheen by type to every product that has a rule.
  const [autoBusy, setAutoBusy] = useState(false);
  async function autoSetSheens() {
    setAutoBusy(true);
    const supabase = createClient();
    const updates = rows.map((r) => ({ r, s: autoSheen(r.name, r.category) })).filter((u) => u.s) as { r: ProductRow; s: string }[];
    setRows((rs) => rs.map((x) => { const u = updates.find((u) => rid(u.r) === rid(x)); return u ? { ...x, finish: u.s } : x; }));
    for (const u of updates) if (u.r.id) await supabase.from("products").update({ finish: u.s }).eq("id", u.r.id);
    setAutoBusy(false);
  }

  async function del(r: ProductRow) {
    if (r.__new) { setRows((rs) => rs.filter((x) => rid(x) !== rid(r))); return; }
    if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("products").delete().eq("id", r.id!);
    if (error) { setMsg((m) => ({ ...m, [rid(r)]: error.message })); return; }
    setRows((rs) => rs.filter((x) => rid(x) !== rid(r)));
  }

  const addProduct = () => {
    const r: ProductRow = { __new: true, __localId: tmp--, name: "", type: "Interior", category: "Interior walls", customer_visible: false, properties: [] };
    setRows((rs) => [...rs, r]);
    setOpen(rid(r));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">Set each product&apos;s sheen from the dropdown on its row (saves instantly), or auto-fill by type.</p>
        <button onClick={autoSetSheens} disabled={autoBusy} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
          {autoBusy ? "Setting…" : "Auto-set sheens by type"}
        </button>
      </div>
      {groups.map(([cat, list]) => (
        <div key={cat}>
          <div className="mb-1 flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">{cat}</h3>
            <span className="text-xs text-gray-400">{list.length}</span>
          </div>
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {list.map((r) => {
              const id = rid(r);
              const expanded = open === id;
              return (
                <div key={id}>
                  {/* summary row */}
                  <div className="flex items-center gap-3 px-3 py-2">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50">
                      {r.photo_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={r.photo_url} alt="" className="h-full w-full object-cover" />
                        : <span className="text-gray-300">🎨</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{r.name || <span className="text-gray-400">Untitled product</span>}</span>
                        {!r.customer_visible && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title={r.source_notes || "Confirm details before showing to customers"}>needs verification</span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-gray-400">{r.brand || ""}</div>
                    </div>
                    <select
                      className="w-28 shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs"
                      value={r.finish ?? ""}
                      onChange={(e) => saveField(r, "finish", e.target.value)}
                      title="Finish / sheen"
                    >
                      <option value="">— sheen —</option>
                      {r.finish && !SHEEN_LEVELS.includes(r.finish) && <option value={r.finish}>{r.finish}</option>}
                      {SHEEN_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={() => setOpen(expanded ? null : id)} className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50">
                      {expanded ? "Close" : "Edit"}
                    </button>
                  </div>

                  {/* detail panel */}
                  {expanded && (
                    <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-3">
                      {r.source_notes && <p className="mb-2 text-[11px] text-amber-700">Source note: {r.source_notes}</p>}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label="Name">{<input className={inp} value={r.name ?? ""} onChange={(e) => patch(r, { name: e.target.value })} />}</Field>
                        <Field label="Brand">{<input className={inp} value={r.brand ?? ""} onChange={(e) => patch(r, { brand: e.target.value })} />}</Field>
                        <Field label="Finish / sheen">
                          <select className={inp} value={r.finish ?? ""} onChange={(e) => patch(r, { finish: e.target.value })}>
                            <option value="">— sheen —</option>
                            {r.finish && !SHEEN_LEVELS.includes(r.finish) && <option value={r.finish}>{r.finish}</option>}
                            {SHEEN_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </Field>
                        <Field label="Category">
                          <select className={inp} value={r.category ?? ""} onChange={(e) => patch(r, { category: e.target.value })}>
                            <option value="" />
                            {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </Field>
                        <Field label="Type">
                          <select className={inp} value={r.type ?? ""} onChange={(e) => patch(r, { type: e.target.value })}>
                            <option value="Interior">Interior</option><option value="Exterior">Exterior</option>
                          </select>
                        </Field>
                        <Field label="Rate-card alias">{<input className={inp} value={r.internal_alias ?? ""} onChange={(e) => patch(r, { internal_alias: e.target.value })} />}</Field>
                      </div>

                      <div className="mt-3">
                        <Field label="Customer blurb (one-liner)">
                          <textarea rows={2} className={inp} value={r.blurb ?? ""} onChange={(e) => patch(r, { blurb: e.target.value })} />
                        </Field>
                      </div>

                      <div className="mt-3">
                        <Field label="Properties (chips)">
                          <TagInput values={r.properties ?? []} onChange={(v) => patch(r, { properties: v })} />
                        </Field>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label="Guarantee">{<input className={inp} value={r.guarantee ?? ""} onChange={(e) => patch(r, { guarantee: e.target.value })} />}</Field>
                        <Field label="Product URL">{<input className={inp} value={r.product_url ?? ""} onChange={(e) => patch(r, { product_url: e.target.value })} />}</Field>
                        <Field label="Coverage (m²/L, staff)">{<input className={inp} value={r.coverage_m2_per_l ?? ""} onChange={(e) => patch(r, { coverage_m2_per_l: e.target.value })} />}</Field>
                        <Field label="Recoat (staff)">{<input className={inp} value={r.recoat ?? ""} onChange={(e) => patch(r, { recoat: e.target.value })} />}</Field>
                        <Field label="Coverage m²/L (pricing)">{<input type="number" className={inp} value={r.coverage ?? ""} onChange={(e) => patch(r, { coverage: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
                        <Field label="Price $/L">{<input type="number" className={inp} value={r.price_per_litre ?? ""} onChange={(e) => patch(r, { price_per_litre: e.target.value === "" ? null : (Number(e.target.value) as unknown as number) })} />}</Field>
                        <Field label="Wastage %">{<input type="number" className={inp} value={r.wastage_pct ?? ""} onChange={(e) => patch(r, { wastage_pct: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                          <input type="checkbox" checked={!!r.customer_visible} onChange={(e) => patch(r, { customer_visible: e.target.checked })} />
                          Show on customer estimate
                        </label>
                        <label className="inline-flex cursor-pointer items-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
                          {uploading === id ? "Uploading…" : r.photo_url ? "Change photo" : "Upload photo"}
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadPhoto(r, e.target.files?.[0])} />
                        </label>
                        {r.photo_url && <button onClick={() => patch(r, { photo_url: null })} className="text-xs text-gray-400 hover:text-red-600">remove photo</button>}
                        <div className="ml-auto flex items-center gap-2">
                          {msg[id] && <span className={`text-xs ${msg[id].startsWith("Saved") ? "text-green-600" : msg[id].includes("uploaded") ? "text-gray-500" : "text-red-600"}`}>{msg[id]}</span>}
                          <button onClick={() => del(r)} className="px-1 text-gray-400 hover:text-red-600" title="Delete">×</button>
                          <button onClick={() => save(r)} disabled={busy === id} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                            {busy === id ? "…" : "Save"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button onClick={addProduct} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Add product</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="text-gray-500">{label}</span><div className="mt-1">{children}</div></label>;
}

function TagInput({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const t = draft.trim(); if (t && !values.includes(t)) onChange([...values, t]); setDraft(""); };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5">
      {values.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded bg-gray-200 px-1.5 py-0.5 text-[11px]">
          {v}
          <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-600">×</button>
        </span>
      ))}
      <input
        className="min-w-[8rem] flex-1 text-sm outline-none"
        placeholder="Add a property + Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
      />
    </div>
  );
}
