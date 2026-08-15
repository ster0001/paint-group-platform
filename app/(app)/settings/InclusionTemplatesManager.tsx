"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INCLUSION_TEMPLATES_KEY, type InclusionTemplate } from "@/lib/estimate/inclusionTemplates";

// Manage the "What's included" templates — named lists of bullet points that can
// be applied to an estimate's inclusions from the builder. One bullet per line.
export default function InclusionTemplatesManager({ initial }: { initial: InclusionTemplate[] }) {
  const [rows, setRows] = useState<InclusionTemplate[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const patch = (id: string, p: Partial<InclusionTemplate>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const addTemplate = () =>
    setRows((rs) => [...rs, { id: crypto.randomUUID(), name: "New template", items: [] }]);

  const removeTemplate = (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  async function save() {
    setBusy(true);
    setMsg("");
    const supabase = createClient();
    // Persist the whole list, trimming blank bullet lines.
    const clean = rows.map((r) => ({ ...r, name: r.name.trim() || "Untitled", items: r.items.map((i) => i.trim()).filter(Boolean) }));
    const { error } = await supabase.from("settings").upsert({ key: INCLUSION_TEMPLATES_KEY, value: clean }, { onConflict: "key" });
    setBusy(false);
    setMsg(error ? error.message : "Saved ✓");
    if (!error) setRows(clean);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Each template is a list of bullet points (one per line). Apply them to an estimate from the builder&apos;s <span className="font-medium">What&apos;s included</span> box.
      </p>

      {rows.map((t) => (
        <div key={t.id} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <input
              className="min-w-[14rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm font-medium"
              value={t.name}
              onChange={(e) => patch(t.id, { name: e.target.value })}
              placeholder="Template name"
            />
            <span className="text-xs text-gray-400">{t.items.filter((i) => i.trim()).length} bullets</span>
            <button onClick={() => removeTemplate(t.id)} className="px-1 text-gray-400 hover:text-red-600" title="Delete template">×</button>
          </div>
          <textarea
            rows={8}
            className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={t.items.join("\n")}
            onChange={(e) => patch(t.id, { items: e.target.value.split("\n") })}
            placeholder={"One bullet per line…"}
          />
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button onClick={addTemplate} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50">+ Add template</button>
        <button onClick={save} disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save templates"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
