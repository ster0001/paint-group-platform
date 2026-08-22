"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { numericSettingValue, settingNotes, settingUnit, withNumber } from "@/lib/settings/numeric";
import { detectManual, derivedOrder, isDerivedSetting, resolveDerived, round2 } from "@/lib/settings/derived";

export type SettingRow = { key: string; value: unknown };

type Row = { key: string; original: unknown; text: string; manual: boolean };

/**
 * The numeric pricing levers — markup, GST, sundries, contractor rate, the
 * overhead figures.
 *
 * Two rules, both learned from the save that never worked. The ORIGINAL value
 * is kept beside the edited number so a save writes `{unit, notes, value}` back
 * whole instead of flattening a lever to a bare number; and a field that isn't
 * a real number stops the save with a message naming it, rather than sending
 * JSON `null` at a NOT NULL column and failing every other row with it.
 *
 * The rows split in two. "Your figures" are the ones you choose. "Calculated
 * from the above" are the seven that are arithmetic on them (see
 * `lib/settings/derived.ts`): they fill themselves in and follow their inputs
 * live, but stay editable — type a different number and the row holds it,
 * shows what the formula says, and offers to go back.
 */
export default function PricingSettings({ initial }: { initial: SettingRow[] }) {
  const [rows, setRows] = useState<Row[]>(() => {
    const base = initial.map((r) => ({
      key: r.key,
      original: r.value,
      // Text, not a number: a half-typed "-" or "1." has to survive keystrokes.
      text: String(numericSettingValue(r.value) ?? 0),
    }));
    const manual = detectManual(base);
    return base.map((r, i) => ({ ...r, manual: manual[i] }));
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const resolved = useMemo(() => resolveDerived(rows), [rows]);

  // Editing a calculated row is the act of overriding it.
  const set = (key: string, text: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, text, manual: r.manual || isDerivedSetting(r.key) } : r,
      ),
    );

  const resetToComputed = (key: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, manual: false } : r)));

  async function saveAll() {
    // Validate and save what is ON SCREEN — for a calculated row that is the
    // computed figure, so the table never keeps a stale one.
    const values = rows.map((_, i) => resolved[i].display);
    const badAt = values.findIndex((v) => v.trim() === "" || !Number.isFinite(Number(v)));
    if (badAt >= 0) {
      setOk(false);
      setMsg(`“${rows[badAt].key}” needs a number.`);
      return;
    }

    setBusy(true);
    setMsg("");
    const payload: { key: string; value: unknown }[] = [];
    rows.forEach((r, i) => {
      const value = withNumber(r.original, Number(values[i]));
      if (value === null) return; // guarded above; belt and braces
      payload.push({ key: r.key, value });
    });

    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert(payload, { onConflict: "key" });
    setBusy(false);
    setOk(!error);
    setMsg(error ? error.message : "Saved ✓");
    // The calculated rows now match what was written; nothing is an override.
    if (!error) setRows((rs) => rs.map((r, i) => ({ ...r, text: values[i], manual: false })));
  }

  if (rows.length === 0) return <p className="text-sm text-gray-500">No pricing settings found.</p>;

  const yours = rows.map((_, i) => i).filter((i) => !resolved[i].spec);
  const calculated = rows
    .map((_, i) => i)
    .filter((i) => resolved[i].spec)
    .sort((a, b) => derivedOrder(rows[a].key) - derivedOrder(rows[b].key));

  const field = (i: number) => {
    const r = rows[i];
    const { spec, computed, display } = resolved[i];
    const unit = settingUnit(r.original);
    const notes = settingNotes(r.original);
    // The formula already says "calculated"; don't print it twice.
    const extraNotes = spec && /^calculated\b/i.test(notes.trim()) ? notes.replace(/^calculated\s*[—-]?\s*/i, "") : notes;
    // Cents, not floating point: a stored 70.8333333333333 IS the formula's 70.83.
    const overridden =
      Boolean(spec) && r.manual && computed !== null && round2(Number(display)) !== computed;

    return (
      <label key={r.key} className="block text-xs">
        <span className="text-gray-700">{r.key}</span>
        {unit && <span className="ml-1 text-gray-400">({unit})</span>}
        <input
          type="number"
          step="any"
          className={`mt-1 w-full rounded-md border px-2 py-1.5 text-sm ${
            overridden ? "border-amber-400 bg-amber-50" : "border-gray-300"
          }`}
          value={display}
          onChange={(e) => set(r.key, e.target.value)}
        />
        {spec && (
          <span className="mt-0.5 block text-[11px] text-gray-400">= {spec.formula}</span>
        )}
        {overridden && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-amber-700">
            Manual override — the formula gives {computed}.
            <button
              type="button"
              onClick={() => resetToComputed(r.key)}
              className="rounded border border-amber-400 px-1.5 py-0.5 font-medium hover:bg-amber-100"
            >
              Reset to calculated
            </button>
          </span>
        )}
        {extraNotes && <span className="mt-0.5 block text-[11px] text-gray-400">{extraNotes}</span>}
      </label>
    );
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{yours.map(field)}</div>
      <p className="mt-2 text-[11px] text-gray-400">
        Rates like markup and GST are fractions (0.1 = 10%). Sundries and contractor rate are in dollars.
      </p>

      {calculated.length > 0 && (
        <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h4 className="text-xs font-semibold text-gray-700">Calculated from the above</h4>
          <p className="mb-3 mt-0.5 text-[11px] text-gray-500">
            These follow the figures you set and update as you type. Nothing prices off them — they are
            your margin read-out. Type over one if you need to; it will say so and offer to go back.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{calculated.map(field)}</div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button onClick={saveAll} disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save all"}
        </button>
        {msg && <span className={`text-sm ${ok ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
