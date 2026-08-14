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
  const [busy, setBusy] = useState<string | number | null>(null);
  const [msg, setMsg] = useState<Record<string | number, string>>({});

  const rid = (r: LineItemRow) => (r.id ?? r.__localId) as string | number;
  const set = (r: LineItemRow, patch: Partial<LineItemRow>) =>
    setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? { ...x, ...patch } : x)));
  const add = () =>
    setRows((rs) => [...rs, { name: "", type: "Interior", pricing_method: "Hourly", description: "", __localId: tmpId--, __new: true }]);

  async function save(r: LineItemRow) {
    if (!r.name.trim()) { setMsg((m) => ({ ...m, [rid(r)]: "Name required" })); return; }
    setBusy(rid(r));
    setMsg((m) => ({ ...m, [rid(r)]: "" }));
    const supabase = createClient();
    const body = { name: r.name.trim(), type: r.type, pricing_method: r.pricing_method, description: r.description ?? "" };
    try {
      let key = rid(r);
      if (r.__new) {
        const { data, error } = await supabase.from("line_items").insert(body).select().single();
        if (error) throw error;
        const nrow = data as LineItemRow;
        setRows((rs) => rs.map((x) => (rid(x) === rid(r) ? nrow : x)));
        key = rid(nrow);
      } else {
        const { error } = await supabase.from("line_items").update(body).eq("id", r.id!);
        if (error) throw error;
      }
      setMsg((m) => ({ ...m, [key]: "Saved ✓" }));
    } catch (e) {
      setMsg((m) => ({ ...m, [rid(r)]: e instanceof Error ? e.message : "Save failed" }));
    } finally {
      setBusy(null);
    }
  }

  async function del(r: LineItemRow) {
    if (r.__new) { setRows((rs) => rs.filter((x) => rid(x) !== rid(r))); return; }
    if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("line_items").delete().eq("id", r.id!);
    if (error) { setMsg((m) => ({ ...m, [rid(r)]: error.message })); return; }
    setRows((rs) => rs.filter((x) => rid(x) !== rid(r)));
  }

  const inp = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <div className="divide-y divide-gray-100">
      {rows.map((r) => {
        const open = openId === rid(r);
        return (
          <div key={rid(r)} className="py-2">
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
              <button onClick={() => save(r)} disabled={busy === rid(r)} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                {busy === rid(r) ? "Saving…" : "Save"}
              </button>
              <button onClick={() => del(r)} className="px-1 text-gray-400 hover:text-red-600" title="Delete">×</button>
              {msg[rid(r)] && <span className={`text-xs ${msg[rid(r)].startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg[rid(r)]}</span>}
            </div>
            {open && (
              <div className="mt-2">
                <RichTextEditor value={r.description ?? ""} onChange={(html) => set(r, { description: html })} placeholder="Description shown to the customer…" />
                <p className="mt-1 text-[11px] text-gray-400">Remember to Save after editing the description.</p>
              </div>
            )}
          </div>
        );
      })}
      <div className="pt-3">
        <button onClick={add} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Add line item</button>
      </div>
    </div>
  );
}
