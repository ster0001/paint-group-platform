"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  EXTERIOR_ALLOWANCES_KEY, type ExteriorAllowanceSettings,
} from "@/lib/wizard/exterior-allowances";
import { SITE_ACCESS_HOURS_KEY, type HourAllowance } from "@/lib/wizard/site-access";

/**
 * Settings → Estimates → Access allowances.
 *
 * The flat hours the estimator allows for GETTING TO the work — inside
 * (parking, a lift booking) and outside (upper levels, awkward ground). They
 * are hours rather than percentages because none of them scale with the job:
 * carrying gear from a side street costs the same two hours whether it is one
 * room or ten, and a second storey adds set-up and pack-down, not painting
 * time.
 *
 * ⚑ The EXTERIOR numbers were recommended rather than measured — Tom asked for
 * advice and accepted them as a starting point (10 Sep). Every job that uses
 * one is flagged on the estimate, so the honest way to settle them is to
 * compare a few jobs' allowances against the hours they actually took and
 * change them here. That is why this screen exists at all: a number nobody can
 * reach is a number nobody can correct.
 */
export default function AccessAllowancesSettings({ interior, exterior }: {
  interior: Record<string, HourAllowance>;
  exterior: ExteriorAllowanceSettings;
}) {
  const [ext, setExt] = useState(exterior);
  const [int, setInt] = useState(interior);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const setExtField = (k: keyof ExteriorAllowanceSettings, v: number) => {
    setExt((f) => ({ ...f, [k]: v })); setDirty(true);
  };
  const setIntHours = (key: string, v: number) => {
    setInt((f) => ({ ...f, [key]: { ...f[key], hours: v } })); setDirty(true);
  };

  async function save() {
    setSaving(true); setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert([
      { key: EXTERIOR_ALLOWANCES_KEY, value: ext },
      { key: SITE_ACCESS_HOURS_KEY, value: int },
    ], { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setDirty(false);
  }

  return (
    <div className="space-y-4" data-testid="access-allowances">
      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Outside — getting to the elevations</div>
        <p className="text-xs text-gray-500">
          These are <strong>provisional</strong>: they were proposed, not measured. Every estimate that uses one says
          so on the job, so compare a few against the hours the work actually took and set the real ones here.
        </p>
        <HourField
          label="Working at height, per side"
          hint="Set-up, moving and pack-down for the upper level. Charged once per side being painted — a job that named three sides is not charged for four."
          testId="ext-upper-storey"
          value={ext.upperStoreyPerSide}
          onChange={(v) => setExtField("upperStoreyPerSide", v)}
        />
        <HourField
          label="Awkward ground, per job"
          hint="Sloping or tight access — planks, footings, and carrying gear the long way round. Once for the job, because that is how the customer is asked."
          testId="ext-difficult-ground"
          value={ext.difficultGroundPerSide}
          onChange={(v) => setExtField("difficultGroundPerSide", v)}
        />
        <p className="text-xs text-gray-500">
          Scaffolding and lifts are never priced here and have no setting. They are quoted as a separate variation
          once somebody has seen the site — a threshold at which we absorbed them would put an unpriced cost into
          exactly the jobs where it is largest.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Inside — getting to the rooms</div>
        {Object.entries(int).map(([key, a]) => (
          <HourField
            key={key}
            label={a.label}
            hint={a.note}
            testId={`int-${key.replace(/[^a-z]+/gi, "-")}`}
            value={a.hours}
            onChange={(v) => setIntHours(key, v)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40" data-testid="access-allowances-save">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}

function HourField({ label, hint, value, onChange, testId }: {
  label: string; hint: string; value: number; onChange: (v: number) => void; testId: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number" min={0} max={40} step={0.25} value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(40, Number(e.target.value) || 0)))}
          className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm" data-testid={testId}
        />
        <span className="text-xs text-gray-500">hours{value === 0 ? " — not charged" : ""}</span>
      </span>
    </label>
  );
}
