"use client";

import { useState } from "react";
import { deleteCrmTagAction, saveCrmTagAction, saveCrmThresholdsAction } from "./crmSettingsActions";
import { THRESHOLD_FIELDS, type CrmThresholds } from "@/lib/crm/thresholds";

/**
 * Settings → CRM (CRM v2 P4): the numbers behind the chase rules (shell brief
 * §7.1 — "all thresholds in Settings, none in code") and the office's tag
 * list. Changing a threshold does not need a deploy; the facts refresh and
 * Today read the row on their next pass.
 */
export type TagRow = { key: string; label: string; colour: string | null; sort_order: number };

export default function CrmSettings({ initial, tags: initialTags }: { initial: CrmThresholds; tags: TagRow[] }) {
  const [form, setForm] = useState<CrmThresholds>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [tags, setTags] = useState<TagRow[]>(initialTags);
  const [newTag, setNewTag] = useState("");

  const groups = [...new Set(THRESHOLD_FIELDS.map((f) => f.group))];

  async function save() {
    setSaving(true); setMsg("");
    const r = await saveCrmThresholdsAction(form);
    setSaving(false);
    setMsg(r.ok ? "Saved. The rules use these from their next pass." : r.message);
    if (r.ok) setDirty(false);
  }
  async function addTag() {
    const label = newTag.trim();
    if (!label) return;
    const r = await saveCrmTagAction(label);
    setMsg(r.ok ? "Tag added." : r.message);
    if (r.ok && r.tag) { setTags((t) => [...t.filter((x) => x.key !== r.tag!.key), r.tag!].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))); setNewTag(""); }
  }
  async function removeTag(key: string) {
    if (!window.confirm("Remove this tag from every customer that carries it?")) return;
    const r = await deleteCrmTagAction(key);
    setMsg(r.ok ? "Tag removed." : r.message);
    if (r.ok) setTags((t) => t.filter((x) => x.key !== key));
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{g}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {THRESHOLD_FIELDS.filter((f) => f.group === g).map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm">
                <span className="text-gray-700">{f.label}</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number" min={f.min} max={f.max} value={form[f.key]}
                    onChange={(e) => { setForm({ ...form, [f.key]: Number(e.target.value) }); setDirty(true); }}
                    className="w-20 rounded border border-gray-300 px-2 py-1 text-right tabular-nums"
                    data-testid={`crm-${f.key}`}
                  />
                  <span className="w-12 text-xs text-gray-500">{f.unit}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!dirty || saving} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40" data-testid="crm-save">
          {saving ? "Saving…" : "Save thresholds"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Tags</h4>
        <p className="mb-2 text-xs text-gray-500">Anything true about a customer that is not a status: referral, strata, heritage, VIP. Filterable on Customers; usable in audiences.</p>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t.key} className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1 text-sm">
              {t.label}
              <button type="button" onClick={() => removeTag(t.key)} className="ml-1 text-gray-400 hover:text-red-600" aria-label={`Remove ${t.label}`}>×</button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTag(); }} placeholder="New tag" className="rounded border border-gray-300 px-2 py-1 text-sm" data-testid="crm-new-tag" />
            <button type="button" onClick={addTag} className="rounded-md border border-gray-300 px-2 py-1 text-sm">Add</button>
          </span>
        </div>
      </div>
    </div>
  );
}
