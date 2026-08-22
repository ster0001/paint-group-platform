"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { numericSettingValue, settingNotes, settingUnit, withNumber } from "@/lib/settings/numeric";

export type SettingRow = { key: string; value: unknown };

/**
 * The numeric pricing levers — markup, GST, sundries, contractor rate, the
 * overhead figures.
 *
 * Two rules, both learned from the save that never worked. The ORIGINAL value
 * is kept beside the edited number so a save writes `{unit, notes, value}` back
 * whole instead of flattening a lever to a bare number; and a field that isn't
 * a real number stops the save with a message naming it, rather than sending
 * JSON `null` at a NOT NULL column and failing every other row with it.
 */
export default function PricingSettings({ initial }: { initial: SettingRow[] }) {
  const [rows, setRows] = useState(() =>
    initial.map((r) => ({
      key: r.key,
      original: r.value,
      // Text, not a number: a half-typed "-" or "1." has to survive keystrokes.
      text: String(numericSettingValue(r.value) ?? 0),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const set = (key: string, text: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, text } : r)));

  async function saveAll() {
    const bad = rows.find((r) => !Number.isFinite(Number(r.text)) || r.text.trim() === "");
    if (bad) {
      setOk(false);
      setMsg(`“${bad.key}” needs a number.`);
      return;
    }

    setBusy(true);
    setMsg("");
    const payload: { key: string; value: unknown }[] = [];
    for (const r of rows) {
      const value = withNumber(r.original, Number(r.text));
      if (value === null) continue; // guarded above; belt and braces
      payload.push({ key: r.key, value });
    }

    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert(payload, { onConflict: "key" });
    setBusy(false);
    setOk(!error);
    setMsg(error ? error.message : "Saved ✓");
  }

  if (rows.length === 0) return <p className="text-sm text-gray-500">No pricing settings found.</p>;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const unit = settingUnit(r.original);
          const notes = settingNotes(r.original);
          return (
            <label key={r.key} className="block text-xs">
              <span className="text-gray-700">{r.key}</span>
              {unit && <span className="ml-1 text-gray-400">({unit})</span>}
              <input
                type="number"
                step="any"
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={r.text}
                onChange={(e) => set(r.key, e.target.value)}
              />
              {/* "Calculated" rows are still editable — they are your figures,
                  not the app's — but it is worth saying which is which. */}
              {notes && <span className="mt-0.5 block text-[11px] text-gray-400">{notes}</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        Rates like markup and GST are fractions (0.1 = 10%). Sundries and contractor rate are in dollars.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={saveAll} disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save all"}
        </button>
        {msg && <span className={`text-sm ${ok ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
