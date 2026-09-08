"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_BANDS, DEFAULT_POLICY, type BandSettings, type WizardPolicySettings } from "@/lib/wizard/policy";
import { WIZARD_REWARDS_KEY, type RewardLine, type WizardRewards } from "@/lib/wizard/ladder";

/**
 * Settings → Estimates → Tiers & rewards (PR 1 of reward-tiers-plan.md).
 *
 * Before this screen the two thresholds and the two caps were SQL-only
 * (`wizard_policy`, `wizard_bands`) and a second, dead copy of the caps sat
 * in `scope_editor`. The tiers ARE these numbers: Bronze below the mid
 * threshold, Silver from it, Gold from the tight threshold when the job is
 * accept-eligible (under the cap, over the bar, nothing needing a person).
 * The rewards are data (`wizard_rewards`), never constants.
 *
 * Same save pattern as Online estimates: the staff session upserts the rows
 * under its own RLS — three rows, one Save.
 */
export default function TiersSettings({ initial }: { initial: { bands: BandSettings; policy: WizardPolicySettings; rewards: WizardRewards } }) {
  const [bands, setBands] = useState<BandSettings>(initial.bands);
  const [policy, setPolicy] = useState<WizardPolicySettings>(initial.policy);
  const [rewards, setRewards] = useState<WizardRewards>(initial.rewards);
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
      { key: WIZARD_REWARDS_KEY, value: rewards },
    ];
    const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setDirty(false);
  }

  const lines = (k: "silver" | "gold") => (
    <div className="space-y-2">
      {rewards[k].map((line, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <input value={line.label} maxLength={80} placeholder="Reward" data-testid={`reward-${k}-label-${i}`}
            onChange={(e) => { const next = [...rewards[k]]; next[i] = { ...line, label: e.target.value }; setRewards({ ...rewards, [k]: next }); touch(); }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          <input value={line.note} maxLength={200} placeholder="What it means to the customer"
            onChange={(e) => { const next = [...rewards[k]]; next[i] = { ...line, note: e.target.value }; setRewards({ ...rewards, [k]: next }); touch(); }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          <button type="button" aria-label="Remove" className="rounded border border-gray-300 px-2 text-xs text-gray-500 hover:bg-gray-50"
            onClick={() => { setRewards({ ...rewards, [k]: rewards[k].filter((_, j) => j !== i) }); touch(); }}>×</button>
        </div>
      ))}
      {rewards[k].length < 6 && (
        <button type="button" className="text-xs text-gray-600 underline" data-testid={`reward-${k}-add`}
          onClick={() => { setRewards({ ...rewards, [k]: [...rewards[k], { label: "", note: "" } as RewardLine] }); touch(); }}>
          + Add a line
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="tiers-settings">
      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">The tiers — from the confidence score</div>
        <p className="text-xs text-gray-500">
          Bronze below the Silver threshold; Silver from it; Gold from the Gold threshold <em>when the job can be accepted online</em> —
          under the cap, over the bar, and nothing that needs a person (exterior always does). The band widths set the range shown at each level.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block text-sm"><span className="text-gray-700">Silver from (%)</span>
            <input type="number" min={0} max={100} value={bands.midMin} data-testid="tier-mid-min" onChange={(e) => { setBands({ ...bands, midMin: num(e.target.value, DEFAULT_BANDS.midMin) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Silver band (±%)</span>
            <input type="number" min={0} max={50} value={bands.midPct} onChange={(e) => { setBands({ ...bands, midPct: num(e.target.value, DEFAULT_BANDS.midPct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Gold from (%)</span>
            <input type="number" min={0} max={100} value={bands.tightMin} data-testid="tier-tight-min" onChange={(e) => { setBands({ ...bands, tightMin: num(e.target.value, DEFAULT_BANDS.tightMin) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Gold band (±%)</span>
            <input type="number" min={0} max={50} value={bands.tightPct} onChange={(e) => { setBands({ ...bands, tightPct: num(e.target.value, DEFAULT_BANDS.tightPct) }); touch(); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-700">Bronze band (±%)</span>
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

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Rewards — applied to the job when the customer goes ahead</div>
        <div className="text-sm font-medium text-gray-700">Silver</div>
        {lines("silver")}
        <div className="pt-2 text-sm font-medium text-gray-700">Gold</div>
        {lines("gold")}
        <label className="flex items-start gap-2 pt-2 text-sm text-gray-700">
          <input type="checkbox" role="switch" checked={rewards.goldSkipVisit} data-testid="gold-skip-visit"
            onChange={(e) => { setRewards({ ...rewards, goldSkipVisit: e.target.checked }); touch(); }} className="mt-1 h-4 w-4 accent-emerald-600" />
          <span>
            <b>Gold: “no site visit — book straight in”.</b>{" "}
            <span className="text-gray-500">Off: a Gold acceptance reads “your estimator confirms it within a business day, at a desk or with a quick look”. Flip it once ~20 Gold desk checks have held inside the range. The build is the same either way — this only changes what we promise.</span>
          </span>
        </label>
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
