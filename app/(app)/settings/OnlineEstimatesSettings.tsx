"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WIZARD_PUBLIC_KEY, type OnlineEstimates } from "@/lib/wizard/publicFlag";

/**
 * Settings → Estimates → Online estimates (Phase 0 of the 6 Sep plan).
 *
 * The public switch for /estimate, and the wording of the holding page the
 * public sees while it is off. Before this folder existed the switch was a
 * settings row only SQL could reach. Same save pattern as Automations: the
 * staff session upserts the row under its own RLS.
 */
export default function OnlineEstimatesSettings({ initial }: { initial: OnlineEstimates }) {
  const [form, setForm] = useState<OnlineEstimates>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof OnlineEstimates>(k: K, v: OnlineEstimates[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };

  async function save() {
    setSaving(true); setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert({ key: WIZARD_PUBLIC_KEY, value: form }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setDirty(false);
  }

  return (
    <div className="space-y-4" data-testid="online-estimates">
      <div className="flex items-start justify-between gap-4 rounded-md border border-gray-200 bg-white p-3">
        <div>
          <div className="text-sm font-medium text-gray-900">Online estimates for the public</div>
          <p className="mt-1 text-xs text-gray-500">
            On: anyone can build an estimate at /estimate. Off: the public sees the holding page below with a
            &ldquo;call me&rdquo; form, and every request lands on Today. Staff previews and signed-in customers always get
            the wizard.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" role="switch" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)}
            aria-label="Online estimates on" data-testid="switch-wizard-public" className="h-4 w-4 accent-emerald-600" />
          <span className={form.enabled ? "text-emerald-700" : "text-gray-400"}>{form.enabled ? "Live" : "Holding"}</span>
        </label>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Holding page wording</div>
        <label className="block text-sm">
          <span className="text-gray-700">Headline</span>
          <input value={form.holdingTitle} maxLength={120} onChange={(e) => set("holdingTitle", e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" data-testid="holding-title" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">The line under it</span>
          <textarea value={form.holdingBody} maxLength={600} rows={3} onChange={(e) => set("holdingBody", e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" data-testid="holding-body" />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40" data-testid="online-estimates-save">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}
