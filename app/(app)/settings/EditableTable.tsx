"use client";

import { Fragment, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptAttr, checkUpload } from "@/lib/uploads/validate";

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
//
// Saving is by SECTION, not by row: edit as many rows as you like, then one
// "Save changes" button at the bottom writes every new or edited row. Set
// `sectionKey` to group rows under headers by that column's value (e.g.
// substrates by their Folder), so a long list reads at a glance.
export default function EditableTable({
  table, columns, rows: initialRows, blank, addLabel = "+ Add", sectionKey,
}: {
  table: string;
  columns: Col[];
  rows: Row[];
  blank: Row; // defaults for a new row; may carry hidden fields (e.g. rate_card_id)
  addLabel?: string;
  sectionKey?: string;
}) {
  const moneyToDollars = (r: Row): Row => {
    const out = { ...r };
    for (const c of columns) if (c.type === "money" && typeof out[c.key] === "number") out[c.key] = (out[c.key] as number) / 100;
    return out;
  };
  const [rows, setRows] = useState<Row[]>(() => initialRows.map(moneyToDollars));
  const [dirty, setDirty] = useState<Set<string | number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [rowErr, setRowErr] = useState<Record<string | number, string>>({});

  const rid = (r: Row) => (r.id ?? r.__localId) as string | number;
  const markDirty = (r: Row) => setDirty((d) => new Set(d).add(rid(r)));
  const setCell = (r: Row, key: string, val: unknown) => {
    setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? { ...x, [key]: val } : x)));
    markDirty(r);
  };
  const addRow = () => {
    const r = { ...blank, __localId: tmpId--, __new: true } as Row;
    setRows((rs) => [...rs, r]);
    markDirty(r);
  };

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

  async function saveAll() {
    const toSave = rows.filter((r) => dirty.has(rid(r)));
    if (toSave.length === 0) { setMsg("Nothing to save."); return; }
    setBusy(true);
    setMsg("");
    setRowErr({});
    const supabase = createClient();
    let saved = 0;
    const failures: Record<string | number, string> = {};
    for (const r of toSave) {
      try {
        if (r.__new) {
          const { data, error } = await supabase.from(table).insert(payload(r)).select().single();
          if (error) throw error;
          const nrow = moneyToDollars(data as Row);
          setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? nrow : x)));
        } else {
          const { error } = await supabase.from(table).update(payload(r)).eq("id", r.id!);
          if (error) throw error;
        }
        saved++;
      } catch (e) {
        failures[rid(r)] = e instanceof Error ? e.message : "Save failed";
      }
    }
    setBusy(false);
    setRowErr(failures);
    setDirty(new Set(Object.keys(failures).map((k) => (Number.isNaN(Number(k)) ? k : Number(k)))));
    const failCount = Object.keys(failures).length;
    setMsg(failCount ? `Saved ${saved}, ${failCount} failed — see the rows marked in red.` : `Saved ${saved} ✓`);
  }

  // Upload a photo to the shared public `estimate-media` bucket and stash its URL
  // in the row. It persists on the next "Save changes", like every other cell.
  async function uploadImage(r: Row, key: string, file?: File | null) {
    if (!file) return;
    const bad = checkUpload(file, "image");
    if (bad) { setRowErr((m) => ({ ...m, [rid(r)]: bad })); return; }
    setUploading(`${rid(r)}:${key}`);
    const supabase = createClient();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `products/${rid(r)}-${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("estimate-media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("estimate-media").getPublicUrl(path);
      setCell(r, key, data.publicUrl);
    } catch (e) {
      setRowErr((m) => ({ ...m, [rid(r)]: e instanceof Error ? e.message : "Upload failed" }));
    } finally {
      setUploading(null);
    }
  }

  async function del(r: Row) {
    if (r.__new) { setRows((rs) => rs.filter((x) => rid(x) !== rid(r))); return; }
    if (!confirm("Delete this row? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.from(table).delete().eq("id", r.id!);
    if (error) { setRowErr((m) => ({ ...m, [rid(r)]: error.message })); return; }
    setRows((rs) => rs.filter((x) => rid(x) !== rid(r)));
  }

  const inp = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  const cell = (r: Row, c: Col) => {
    if (c.type === "image") {
      return (
        <div className="flex items-center gap-2">
          {r[c.key] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(r[c.key])} alt="" className="h-10 w-10 shrink-0 rounded border border-gray-200 object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-gray-300 text-gray-300">🎨</div>
          )}
          <label className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800">
            {uploading === `${rid(r)}:${c.key}` ? "Uploading…" : r[c.key] ? "Change" : "Upload"}
            <input type="file" accept={acceptAttr("image")} className="hidden" onChange={(e) => uploadImage(r, c.key, e.target.files?.[0])} />
          </label>
          {r[c.key] ? <button onClick={() => setCell(r, c.key, null)} className="text-xs text-gray-400 hover:text-red-600">remove</button> : null}
        </div>
      );
    }
    if (c.type === "select") {
      const cur = String(r[c.key] ?? "");
      const opts = c.options ?? [];
      // Keep an existing off-list value selectable so a dropdown never silently
      // drops a value someone typed before the list existed.
      const all = cur && !opts.includes(cur) ? [cur, ...opts] : opts;
      return (
        <select className={inp} value={cur} onChange={(e) => setCell(r, c.key, e.target.value)}>
          <option value="" />
          {all.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (c.type === "bool") {
      return <input type="checkbox" checked={!!r[c.key]} onChange={(e) => setCell(r, c.key, e.target.checked)} />;
    }
    return (
      <input
        type={c.type === "number" || c.type === "money" ? "number" : "text"}
        className={inp}
        value={r[c.key] == null ? "" : String(r[c.key])}
        onChange={(e) => setCell(r, c.key, e.target.value)}
      />
    );
  };

  const rowEl = (r: Row) => (
    <tr key={rid(r)} className={`border-t border-gray-100 align-top ${rowErr[rid(r)] ? "bg-red-50" : dirty.has(rid(r)) ? "bg-amber-50" : ""}`}>
      {columns.map((c) => <td key={c.key} className="px-1 py-1">{cell(r, c)}</td>)}
      <td className="whitespace-nowrap px-1 py-1 text-right">
        <button onClick={() => del(r)} className="px-1 text-gray-400 hover:text-red-600" title="Delete">×</button>
        {rowErr[rid(r)] && <div className="text-[11px] text-red-600">{rowErr[rid(r)]}</div>}
      </td>
    </tr>
  );

  // Group into sections by the sectionKey column, preserving the incoming order.
  const sections: Array<{ name: string; rows: Row[] }> = [];
  if (sectionKey) {
    const index = new Map<string, number>();
    for (const r of rows) {
      const name = String(r[sectionKey] ?? "").trim() || "Unfiled";
      if (!index.has(name)) { index.set(name, sections.length); sections.push({ name, rows: [] }); }
      sections[index.get(name)!].rows.push(r);
    }
  }

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
            {sectionKey
              ? sections.map((s) => (
                  <Fragment key={s.name}>
                    <tr className="bg-gray-50">
                      <td colSpan={columns.length + 1} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {s.name} <span className="font-normal text-gray-400">· {s.rows.length}</span>
                      </td>
                    </tr>
                    {s.rows.map(rowEl)}
                  </Fragment>
                ))
              : rows.map(rowEl)}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={addRow} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">{addLabel}</button>
        <button
          onClick={saveAll}
          disabled={busy || dirty.size === 0}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : dirty.size > 0 ? `Save changes (${dirty.size})` : "Save changes"}
        </button>
        {msg && <span className={`text-xs ${msg.includes("failed") ? "text-red-600" : "text-green-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
