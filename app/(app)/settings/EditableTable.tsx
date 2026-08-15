"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Col = {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "select" | "bool" | "image";
  options?: string[];
  width?: string;
};
type Row = Record<string, unknown> & { id?: string; __localId?: number; __new?: boolean };

let tmpId = -1;

// Generic add / edit / delete table backed by a Supabase table. Money columns
// are stored as integer cents but shown/edited in dollars.
export default function EditableTable({
  table, columns, rows: initialRows, blank, addLabel = "+ Add",
}: {
  table: string;
  columns: Col[];
  rows: Row[];
  blank: Row; // defaults for a new row; may carry hidden fields (e.g. rate_card_id)
  addLabel?: string;
}) {
  const moneyToDollars = (r: Row): Row => {
    const out = { ...r };
    for (const c of columns) if (c.type === "money" && typeof out[c.key] === "number") out[c.key] = (out[c.key] as number) / 100;
    return out;
  };
  const [rows, setRows] = useState<Row[]>(() => initialRows.map(moneyToDollars));
  const [busy, setBusy] = useState<string | number | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string | number, string>>({});

  const rid = (r: Row) => (r.id ?? r.__localId) as string | number;
  const setCell = (r: Row, key: string, val: unknown) =>
    setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? { ...x, [key]: val } : x)));
  const addRow = () => setRows((rs) => [...rs, { ...blank, __localId: tmpId--, __new: true }]);

  const payload = (r: Row) => {
    const p: Record<string, unknown> = {};
    for (const c of columns) {
      let v = r[c.key];
      if (c.type === "money") v = v === "" || v == null ? null : Math.round(Number(v) * 100);
      else if (c.type === "number") v = v === "" || v == null ? null : Number(v);
      else if (c.type === "bool") v = !!v;
      p[c.key] = v;
    }
    // carry hidden defaults (non-column, non-meta keys like rate_card_id)
    for (const k of Object.keys(blank)) if (!(k in p) && !k.startsWith("__")) p[k] = blank[k];
    return p;
  };

  async function save(r: Row) {
    setBusy(rid(r));
    setMsg((m) => ({ ...m, [rid(r)]: "" }));
    const supabase = createClient();
    try {
      let key = rid(r);
      if (r.__new) {
        const { data, error } = await supabase.from(table).insert(payload(r)).select().single();
        if (error) throw error;
        const nrow = moneyToDollars(data as Row);
        setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? nrow : x)));
        key = rid(nrow);
      } else {
        const { error } = await supabase.from(table).update(payload(r)).eq("id", r.id!);
        if (error) throw error;
      }
      setMsg((m) => ({ ...m, [key]: "Saved ✓" }));
    } catch (e) {
      setMsg((m) => ({ ...m, [rid(r)]: e instanceof Error ? e.message : "Save failed" }));
    } finally {
      setBusy(null);
    }
  }

  // Upload a photo to the shared public `estimate-media` bucket and stash its URL
  // in the row. The user still clicks Save to persist it, like every other cell.
  async function uploadImage(r: Row, key: string, file?: File | null) {
    if (!file) return;
    setUploading(`${rid(r)}:${key}`);
    setMsg((m) => ({ ...m, [rid(r)]: "" }));
    const supabase = createClient();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `products/${rid(r)}-${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("estimate-media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("estimate-media").getPublicUrl(path);
      setCell(r, key, data.publicUrl);
    } catch (e) {
      setMsg((m) => ({ ...m, [rid(r)]: e instanceof Error ? e.message : "Upload failed" }));
    } finally {
      setUploading(null);
    }
  }

  async function del(r: Row) {
    if (r.__new) { setRows((rs) => rs.filter((x) => rid(x) !== rid(r))); return; }
    if (!confirm("Delete this row? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.from(table).delete().eq("id", r.id!);
    if (error) { setMsg((m) => ({ ...m, [rid(r)]: error.message })); return; }
    setRows((rs) => rs.filter((x) => rid(x) !== rid(r)));
  }

  const inp = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              {columns.map((c) => <th key={c.key} className="px-2 py-1 font-medium" style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rid(r)} className="border-t border-gray-100 align-top">
                {columns.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    {c.type === "image" ? (
                      <div className="flex items-center gap-2">
                        {r[c.key] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={String(r[c.key])} alt="" className="h-10 w-10 shrink-0 rounded border border-gray-200 object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-gray-300 text-gray-300">🎨</div>
                        )}
                        <label className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800">
                          {uploading === `${rid(r)}:${c.key}` ? "Uploading…" : r[c.key] ? "Change" : "Upload"}
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadImage(r, c.key, e.target.files?.[0])} />
                        </label>
                        {r[c.key] ? (
                          <button onClick={() => setCell(r, c.key, null)} className="text-xs text-gray-400 hover:text-red-600">remove</button>
                        ) : null}
                      </div>
                    ) : c.type === "select" ? (
                      <select className={inp} value={String(r[c.key] ?? "")} onChange={(e) => setCell(r, c.key, e.target.value)}>
                        <option value="" />
                        {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : c.type === "bool" ? (
                      <input type="checkbox" checked={!!r[c.key]} onChange={(e) => setCell(r, c.key, e.target.checked)} />
                    ) : (
                      <input
                        type={c.type === "number" || c.type === "money" ? "number" : "text"}
                        className={inp}
                        value={r[c.key] == null ? "" : String(r[c.key])}
                        onChange={(e) => setCell(r, c.key, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-1 py-1 text-right">
                  <button onClick={() => save(r)} disabled={busy === rid(r)} className="rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                    {busy === rid(r) ? "…" : "Save"}
                  </button>
                  <button onClick={() => del(r)} className="ml-1 px-1 text-gray-400 hover:text-red-600" title="Delete">×</button>
                  {msg[rid(r)] && <div className={`text-[11px] ${msg[rid(r)].startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg[rid(r)]}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addRow} className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">{addLabel}</button>
    </div>
  );
}
