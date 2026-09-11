"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BANDS, DEFAULT_POLICY, type BandSettings, type WizardPolicySettings } from "@/lib/wizard/policy";

/**
 * Settings → Estimates → Accuracy tiers & online cap (C1, audit 9.2).
 *
 * Before this screen the two thresholds and the two caps were SQL-only
 * (`wizard_policy`, `wizard_bands`) and a second, dead copy of the caps sat in
 * `scope_editor`, re-applied by three call sites. That is what made 9.2 true:
 * changing a cap in Settings moved one surface and left the others behind.
 * `lib/wizard/ladder.ts` is now the only reader of the decision, so the numbers
 * on this screen are the numbers the customer meets — everywhere.
 *
 * The three tiers are ACCURACY LABELS over the band evaluator — what we know
 * about the job — never a status the customer earns and never attached to a
 * benefit (ruling G, 11 Sep). No rewards, no bronze/silver/gold.
 *
 * Same save pattern as Online estimates: the staff session upserts the rows
 * under its own RLS — two rows, one Save.
 */
export default function TiersSettings({ initial }: { initial: { bands: BandSettings; policy: WizardPolicySettings } }) {
  const [bands, setBands] = useState<BandSettings>(initial.bands);
  const [policy, setPolicy] = useState<WizardPolicySettings>(initial.policy);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const num = (v: string, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fallback; };
  const dollars = (cents: number) => String(Math.round(cents / 100));

  async function save() {
    setSaving(true); setMsg("");
    const supabase = createClient();
    const rows = [
      { key: "wizard_bands", value: bands },
      { key: "wizard_policy", value: policy },
    ];
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setDirty(false);
  }

  return (
    <div className="space-y-4" data-testid="tiers-settings">
      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">The tiers — from the confidence score</div>
        <p className="text-xs text-gray-500">
          Guide below the Detailed threshold; Detailed from it; Confirmed from the Confirmed threshold <em>when the job can be
          accepted online</em> — under the cap, over the bar, and nothing that needs a person (exterior always does). The band
          widths set the range shown at each level. These are labels for how much we know, not rewards the customer earns.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block text-sm"><span className="text-gray-700">Detailed from (%)</span>
            <input type="number" min={0} max={100} value={bands.midMin} data-testid="tier-mid-min" onChange={(e) => { setBands({ ...bands, midMin: num(e.target.value, DEFAULT_BANDS.midMin) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Detailed band (±%)</span>
            <input type="number" min={0} max={50} value={bands.midPct} onChange={(e) => { setBands({ ...bands, midPct: num(e.target.value, DEFAULT_BANDS.midPct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Confirmed from (%)</span>
            <input type="number" min={0} max={100} value={bands.tightMin} data-testid="tier-tight-min" onChange={(e) => { setBands({ ...bands, tightMin: num(e.target.value, DEFAULT_BANDS.tightMin) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Confirmed band (±%)</span>
            <input type="number" min={0} max={50} value={bands.tightPct} onChange={(e) => { setBands({ ...bands, tightPct: num(e.target.value, DEFAULT_BANDS.tightPct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Guide band (±%)</span>
            <input type="number" min={0} max={50} value={bands.widePct} onChange={(e) => { setBands({ ...bands, widePct: num(e.target.value, DEFAULT_BANDS.widePct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Accepting online — the caps</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className="block text-sm"><span className="text-gray-700">Interior cap ($)</span>
            <input type="number" min={0} value={dollars(policy.interiorSelfServeCapCents)} data-testid="cap-interior" onChange={(e) => { setPolicy({ ...policy, interiorSelfServeCapCents: num(e.target.value, DEFAULT_POLICY.interiorSelfServeCapCents / 100) * 100 }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Interior bar (%)</span>
            <input type="number" min={0} max={100} value={policy.interiorSelfServeMinAccuracyPct} onChange={(e) => { setPolicy({ ...policy, interiorSelfServeMinAccuracyPct: num(e.target.value, DEFAULT_POLICY.interiorSelfServeMinAccuracyPct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Exterior cap ($)</span>
            <input type="number" min={0} value={dollars(policy.exteriorSelfServeCapCents)} onChange={(e) => { setPolicy({ ...policy, exteriorSelfServeCapCents: num(e.target.value, DEFAULT_POLICY.exteriorSelfServeCapCents / 100) * 100 }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Exterior bar (%)</span>
            <input type="number" min={0} max={100} value={policy.exteriorSelfServeMinAccuracyPct} onChange={(e) => { setPolicy({ ...policy, exteriorSelfServeMinAccuracyPct: num(e.target.value, DEFAULT_POLICY.exteriorSelfServeMinAccuracyPct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Minimum job ($)</span>
            <input type="number" min={0} value={dollars(policy.minJobCents)} onChange={(e) => { setPolicy({ ...policy, minJobCents: num(e.target.value, DEFAULT_POLICY.minJobCents / 100) * 100 }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
        </div>
        <p className="text-xs text-gray-500">Exterior never accepts online whatever the numbers say — an estimator signs every exterior job off (21 Aug). The exterior cap only shapes the wording.</p>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40" data-testid="tiers-save">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}
