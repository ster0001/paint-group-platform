"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { bandLabel, SITE_ALLOWANCES_KEY, type AllowanceBand, type SiteAllowanceSettings } from "@/lib/pricing/allowances";

/**
 * Settings → Pricing → Site allowances by job size (go-live brief §3, 18 Nov 2026).
 *
 * The one table the engine reads for set-up and preparation hours, cleaning
 * hours and sundries: six bands of painting hours, interior and exterior, and
 * the cleaning rate. Saved whole as the `site_allowances` row; a blank or
 * nonsense cell falls back to the shipped value when read (lib/pricing/allowances.ts).
 * Edits apply to estimates created from now on — every saved estimate carries
 * its own explicit figures (migration 20270317), so nothing already priced moves.
 */
export default function SiteAllowancesSettings({ initial }: { initial: SiteAllowanceSettings }) {
  const [scale, setScale] = useState<SiteAllowanceSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const setCell = (side: "interior" | "exterior", i: number, field: keyof Omit<AllowanceBand, "upToHours">, raw: string) => {
    const n = Number(raw);
    const value = field === "sundriesCents" ? Math.round(n * 100) : n;
    setScale((s) => ({ ...s, [side]: s[side].map((b, j) => (j === i ? { ...b, [field]: value } : b)) }));
    setDirty(true);
  };

  async function save() {
    setSaving(true); setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert({ key: SITE_ALLOWANCES_KEY, value: scale }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setDirty(false);
  }

  const table = (side: "interior" | "exterior", title: string) => (
    <div className="mt-3" data-testid={`site-allowances-${side}`}>
      <h4 className="text-xs font-semibold text-gray-700">{title}</h4>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th className="py-1 pr-3 font-medium">Painting hours</th>
            <th className="py-1 pr-3 font-medium">Set-up and prep (h)</th>
            <th className="py-1 pr-3 font-medium">Cleaning (h)</th>
            <th className="py-1 pr-3 font-medium">Sundries ($)</th>
          </tr>
        </thead>
        <tbody>
          {scale[side].map((b, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="py-1 pr-3 text-gray-700">{bandLabel(scale[side], i)}</td>
              {(["prepHours", "cleaningHours", "sundriesCents"] as const).map((field) => (
                <td key={field} className="py-1 pr-3">
                  <input
                    type="number" step={field === "sundriesCents" ? 5 : 0.5} min={0}
                    className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums"
                    value={field === "sundriesCents" ? Math.round(b.sundriesCents) / 100 : b[field]}
                    onChange={(e) => setCell(side, i, field, e.target.value)}
                    aria-label={`${title} ${bandLabel(scale[side], i)} ${field}`}
                    data-testid={`site-allowance-${side}-${i}-${field}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div data-testid="site-allowances">
      <p className="text-xs text-gray-500">
        What every estimate adds for site set-up, cleaning and sundries, by the size of the job (its painting hours, per side).
        Prep hours are charged at the painting charge-out rate; cleaning at the rate below. A &ldquo;both&rdquo; job takes the
        interior row for its inside hours and the exterior row for its outside hours. The estimator can type a different figure on any estimate.
      </p>
      {table("interior", "Interior")}
      {table("exterior", "Exterior")}
      <label className="mt-4 flex items-center gap-2 text-sm">
        <span className="text-gray-700">Cleaning rate</span>
        <span className="text-gray-400">$</span>
        <input
          type="number" step={1} min={0}
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums"
          value={Math.round(scale.cleaningRateCents) / 100}
          onChange={(e) => { setScale((s) => ({ ...s, cleaningRateCents: Math.round(Number(e.target.value) * 100) })); setDirty(true); }}
          aria-label="Cleaning rate ($ per hour)"
          data-testid="site-allowance-cleaning-rate"
        />
        <span className="text-gray-500">per hour (the painting charge-out is on the rate card)</span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="site-allowances-save">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
