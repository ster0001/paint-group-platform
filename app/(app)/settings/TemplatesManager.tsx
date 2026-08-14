"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type TemplateMeta = { id: string; name: string; createdAt?: string };
type StoredTemplate = TemplateMeta & { builder_state?: unknown };

// Manage saved estimate templates (rename / delete). Templates are created from
// the estimate builder via "Save as template"; they live in the settings store.
export default function TemplatesManager({ initial }: { initial: TemplateMeta[] }) {
  const [rows, setRows] = useState<TemplateMeta[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  // Read the full stored list (with builder_state), apply a change, write it back.
  async function mutate(fn: (list: StoredTemplate[]) => StoredTemplate[]) {
    const supabase = createClient();
    const { data } = await supabase.from("settings").select("value").eq("key", "estimate_templates").maybeSingle();
    const list = Array.isArray(data?.value) ? (data!.value as StoredTemplate[]) : [];
    const next = fn(list);
    const { error } = await supabase.from("settings").upsert({ key: "estimate_templates", value: next }, { onConflict: "key" });
    if (error) throw error;
    return next;
  }

  async function rename(t: TemplateMeta) {
    setBusy(t.id);
    setMsg("");
    try {
      await mutate((list) => list.map((x) => (x.id === t.id ? { ...x, name: t.name } : x)));
      setMsg("Saved ✓");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(t: TemplateMeta) {
    if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    setBusy(t.id);
    setMsg("");
    try {
      await mutate((list) => list.filter((x) => x.id !== t.id));
      setRows((rs) => rs.filter((x) => x.id !== t.id));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No templates saved yet. Open an estimate and click <span className="font-medium">Save as template</span> to create one — it will appear here and in the New-estimate chooser.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((t) => (
        <div key={t.id} className="flex items-center gap-2">
          <input
            className="min-w-[14rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={t.name}
            onChange={(e) => setRows((rs) => rs.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))}
          />
          <button onClick={() => rename(t)} disabled={busy === t.id} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {busy === t.id ? "…" : "Rename"}
          </button>
          <button onClick={() => remove(t)} className="px-1 text-gray-400 hover:text-red-600" title="Delete template">×</button>
        </div>
      ))}
      {msg && <p className={`text-xs ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
    </div>
  );
}
