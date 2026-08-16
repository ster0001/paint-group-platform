"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ColourRow = { id: string; brand: string; name: string; hex: string; collection: string | null };

const normHex = (h: string) => { let s = h.trim(); if (s && s[0] !== "#") s = "#" + s; return /^#[0-9a-fA-F]{6}$/.test(s) ? s : ""; };

export default function ColoursManager({ initial }: { initial: ColourRow[] }) {
  const [rows, setRows] = useState<ColourRow[]>(initial);
  const [brand, setBrand] = useState("Dulux");
  const [name, setName] = useState(""); const [hex, setHex] = useState("#");
  const [msg, setMsg] = useState("");

  const groups = useMemo(() => {
    const m = new Map<string, ColourRow[]>();
    for (const r of rows) { if (!m.has(r.brand)) m.set(r.brand, []); m.get(r.brand)!.push(r); }
    return [...m.entries()].sort((a, z) => a[0].localeCompare(z[0]));
  }, [rows]);

  async function add() {
    const h = normHex(hex); const n = name.trim();
    if (!n || !h) { setMsg("Enter a name and a valid #hex."); return; }
    const { data, error } = await createClient().from("colours").insert({ brand: brand.trim() || "Custom", name: n, hex: h }).select("id,brand,name,hex,collection").single();
    if (error) { setMsg(error.message); return; }
    setRows((rs) => [...rs, data as ColourRow]); setName(""); setHex("#"); setMsg("Added ✓");
  }
  async function del(r: ColourRow) {
    if (!confirm(`Delete ${r.brand} ${r.name}?`)) return;
    const { error } = await createClient().from("colours").delete().eq("id", r.id);
    if (error) { setMsg(error.message); return; }
    setRows((rs) => rs.filter((x) => x.id !== r.id));
  }

  const inp = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Your visual colour library, used by the colour picker on estimates and work orders. On-screen colour is a guide only — confirm with a physical sample. Add your own any time.</p>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3">
        <label className="text-xs"><span className="text-gray-500">Brand</span><input className={`mt-1 w-32 ${inp}`} value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        <label className="text-xs"><span className="text-gray-500">Colour name</span><input className={`mt-1 w-44 ${inp}`} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-xs"><span className="text-gray-500">Hex</span><input className={`mt-1 w-24 ${inp}`} value={hex} onChange={(e) => setHex(e.target.value)} placeholder="#EFEADB" /></label>
        <span className="mb-1 inline-block h-7 w-7 rounded border border-gray-300" style={{ background: normHex(hex) || "#fff" }} />
        <button onClick={add} className="mb-0.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Add colour</button>
        {msg && <span className={`mb-1 text-xs ${msg.includes("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>

      {groups.map(([b, list]) => (
        <div key={b}>
          <div className="mb-1 flex items-baseline gap-2"><h3 className="text-sm font-semibold">{b}</h3><span className="text-xs text-gray-400">{list.length}</span></div>
          <div className="flex flex-wrap gap-2">
            {list.map((r) => (
              <div key={r.id} className="group flex items-center gap-2 rounded-lg border border-gray-200 py-1 pl-1 pr-2">
                <span className="h-8 w-8 rounded border border-black/10" style={{ background: r.hex }} />
                <span className="text-xs">
                  <span className="block font-medium">{r.name}</span>
                  <span className="block font-mono text-[10px] text-gray-400">{r.hex}</span>
                </span>
                <button onClick={() => del(r)} className="text-gray-300 hover:text-red-600" title="Delete">×</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
