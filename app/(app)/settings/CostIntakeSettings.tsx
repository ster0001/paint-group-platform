"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  COST_INTAKE_KEY,
  DEFAULT_AUTO_CONFIRM_EXACT_REF,
  DEFAULT_DUPLICATE_WINDOW_DAYS,
  DEFAULT_EXPENSE_THRESHOLD_CENTS,
} from "@/lib/costs/intake";

/**
 * Cost intake settings — every ⚑ from the cost-capture brief as a Settings
 * value (⚑A1 auto-confirm · duplicate window · ⚑A5 contractor threshold).
 * Auto-confirm stays OFF until the intake queue's accuracy readout earns it —
 * the toggle exists so Tom can flip it without a code change; while the
 * pipeline runs everything-human-confirmed it is deliberately inert.
 */

type Values = {
  duplicateWindowDays: number;
  autoConfirmExactRef: boolean;
  expenseThresholdCents: number;
};

const DEFAULTS: Values = {
  duplicateWindowDays: DEFAULT_DUPLICATE_WINDOW_DAYS,
  autoConfirmExactRef: DEFAULT_AUTO_CONFIRM_EXACT_REF,
  expenseThresholdCents: DEFAULT_EXPENSE_THRESHOLD_CENTS,
};

export default function CostIntakeSettings({ initial }: { initial: Partial<Values> | null }) {
  const [values, setValues] = useState<Values>({ ...DEFAULTS, ...(initial ?? {}) });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    const supabase = createClient();
    // Merge, never replace — the key also carries the claimable categories.
    const { data: existing } = await supabase
      .from("settings").select("value").eq("key", COST_INTAKE_KEY).maybeSingle();
    const merged = { ...((existing?.value as Record<string, unknown>) ?? {}), ...values };
    const { error } = await supabase
      .from("settings").upsert({ key: COST_INTAKE_KEY, value: merged }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓ — the intake queue reads this straight away.");
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ci-window" className="text-sm font-medium text-gray-700">Duplicate window (days)</label>
        <input id="ci-window" type="number" min={1} max={90} value={values.duplicateWindowDays}
          onChange={(e) => setValues((v) => ({ ...v, duplicateWindowDays: Math.max(1, Math.min(90, Number(e.target.value) || DEFAULTS.duplicateWindowDays)) }))}
          className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-gray-400">
          Two documents with the same total, date and sender inside this window are flagged as one.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <input id="ci-autoconfirm" type="checkbox" checked={values.autoConfirmExactRef}
          onChange={(e) => setValues((v) => ({ ...v, autoConfirmExactRef: e.target.checked }))}
          className="mt-1" />
        <div>
          <label htmlFor="ci-autoconfirm" className="text-sm font-medium text-gray-700">
            Auto-confirm exact order-reference matches
          </label>
          <p className="text-xs text-gray-400">
            OFF for the first month — everything is confirmed by a person. The accuracy readout on
            the intake queue is the evidence for turning this on. (While OFF-by-policy the pipeline
            ignores it even if ticked.)
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="ci-threshold" className="text-sm font-medium text-gray-700">Contractor pre-approval threshold ($)</label>
        <input id="ci-threshold" type="number" min={0} step={1} value={values.expenseThresholdCents / 100}
          onChange={(e) => setValues((v) => ({ ...v, expenseThresholdCents: Math.max(0, Math.round((Number(e.target.value) || 0) * 100)) }))}
          className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-gray-400">
          Contractor expenses over this need ask-first approval (lands with the contractor Expenses build).
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
    </div>
  );
}
