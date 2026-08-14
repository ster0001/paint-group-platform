"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SettingRow = { key: string; value: unknown };

const asNumber = (v: unknown): number =>
  v == null ? 0 : typeof v === "number" ? v : typeof v === "object" && v && "value" in v ? Number((v as { value: unknown }).value) : Number(v);

// Editable numeric job/pricing settings (markup, GST, sundries, contractor
// rate…). Stored in the flexible settings key/value table.
export default function PricingSettings({ initial }: { initial: SettingRow[] }) {
  const [rows, setRows] = useState(() => initial.map((r) => ({ key: r.key, value: asNumber(r.value) })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const set = (key: string, value: number) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, value } : r)));

  async function saveAll() {
    setBusy(true);
    setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert(rows.map((r) => ({ key: r.key, value: r.value })), { onConflict: "key" });
    setBusy(false);
    setMsg(error ? error.message : "Saved ✓");
  }

  if (rows.length === 0) return <p className="text-sm text-gray-500">No pricing settings found.</p>;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <label key={r.key} className="block text-xs">
            <span className="text-gray-500">{r.key}</span>
            <input
              type="number"
              step="any"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              value={r.value}
              onChange={(e) => set(r.key, e.target.value === "" ? 0 : Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Rates like markup and GST are fractions (0.1 = 10%). Sundries and contractor rate are in dollars.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={saveAll} disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save all"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
