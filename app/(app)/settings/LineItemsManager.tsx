"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RichTextEditor from "@/app/components/RichTextEditor";

export type LineItemRow = {
  id?: string;
  name: string;
  type: string | null;
  pricing_method: string | null;
  description: string | null;
  __localId?: number;
  __new?: boolean;
};

let tmpId = -1;

// Full add / edit / delete for line-item templates. New items save to the
// line_items table and then appear in the estimate builder's line-item picker.
export default function LineItemsManager({ initial }: { initial: LineItemRow[] }) {
  const [rows, setRows] = useState<LineItemRow[]>(initial);
  const [openId, setOpenId] = useState<string | number | null>(null);
  const [dirty, setDirty] = useState<Set<string | number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rowErr, setRowErr] = useState<Record<string | number, string>>({});

  const rid = (r: LineItemRow) => (r.id ?? r.__localId) as string | number;
  const set = (r: LineItemRow, patch: Partial<LineItemRow>) => {
    setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? { ...x, ...patch } : x)));
    setDirty((d) => new Set(d).add(rid(r)));
  };
  const add = () => {
    const r: LineItemRow = { name: "", type: "Interior", pricing_method: "Hourly", description: "", __localId: tmpId--, __new: true };
    setRows((rs) => [...rs, r]);
    setDirty((d) => new Set(d).add(rid(r)));
  };

  // One save for the whole section (feature #8b): writes every new/edited item.
  async function saveAll() {
    const toSave = rows.filter((r) => dirty.has(rid(r)));
    if (toSave.length === 0) { setMsg("Nothing to save."); return; }
    const blank = toSave.find((r) => !r.name.trim());
    if (blank) { setRowErr({ [rid(blank)]: "Name required" }); setMsg("Every line item needs a name."); return; }
    setBusy(true); setMsg(""); setRowErr({});
    const supabase = createClient();
    let saved = 0; const failures: Record<string | number, string> = {};
    for (const r of toSave) {
      const body = { name: r.name.trim(), type: r.type, pricing_method: r.pricing_method, description: r.description ?? "" };
      try {
        if (r.__new) {
          const { data, error } = await supabase.from("line_items").insert(body).select().single();
          if (error) throw error;
          setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? (data as LineItemRow) : x)));
        } else {
          const { error } = await supabase.from("line_items").update(body).eq("id", r.id!);
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
    setMsg(failCount ? `Saved ${saved}, ${failCount} failed.` : `Saved ${saved} ✓`);
  }

  async function del(r: LineItemRow) {
    if (r.__new) { setRows((rs) => rs.filter((x) => rid(x) !== rid(r))); return; }
    if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("line_items").delete().eq("id", r.id!);
    if (error) { setRowErr((m) => ({ ...m, [rid(r)]: error.message })); return; }
    setRows((rs) => rs.filter((x) => rid(x) !== rid(r)));
  }

  const inp = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <div className="divide-y divide-gray-100">
      {rows.map((r) => {
        const open = openId === rid(r);
        return (
          <div key={rid(r)} className={`py-2 ${rowErr[rid(r)] ? "bg-red-50" : dirty.has(rid(r)) ? "bg-amber-50" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inp} min-w-[12rem] flex-1`} placeholder="Line item name" value={r.name} onChange={(e) => set(r, { name: e.target.value })} />
              <select className={inp} value={r.type ?? ""} onChange={(e) => set(r, { type: e.target.value })}>
                <option>Interior</option><option>Exterior</option>
              </select>
              <select className={inp} value={r.pricing_method ?? ""} onChange={(e) => set(r, { pricing_method: e.target.value })}>
                <option>Hourly</option><option>Quantity</option><option>Custom</option>
              </select>
              <button onClick={() => setOpenId(open ? null : rid(r))} className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium hover:bg-gray-50">
                {open ? "▾ Description" : "▸ Description"}
              </button>
              <button onClick={() => del(r)} className="px-1 text-gray-400 hover:text-red-600" title="Delete">×</button>
              {rowErr[rid(r)] && <span className="text-xs text-red-600">{rowErr[rid(r)]}</span>}
            </div>
            {open && (
              <div className="mt-2">
                <RichTextEditor value={r.description ?? ""} onChange={(html) => set(r, { description: html })} placeholder="Description shown to the customer…" />
              </div>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-3">
        <button onClick={add} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Add line item</button>
        <button onClick={saveAll} disabled={busy || dirty.size === 0} className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy ? "Saving…" : dirty.size > 0 ? `Save changes (${dirty.size})` : "Save changes"}
        </button>
        {msg && <span className={`text-xs ${msg.includes("failed") || msg.includes("needs") ? "text-red-600" : "text-green-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
