"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const TERMS_KEY = "terms_conditions";

// Free-text terms & conditions, shown on every estimate below the accept panel.
export default function TermsEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    const supabase = createClient();
    const { error } = await supabase.from("settings").upsert({ key: TERMS_KEY, value: text }, { onConflict: "key" });
    setSaving(false);
    setMsg(error ? error.message : "Saved ✓");
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        These appear on every estimate, below the &ldquo;Accept&rdquo; section. Blank lines separate paragraphs.
      </p>
      <textarea
        rows={16}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter your full terms and conditions…"
      />
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg}</span>}
      </div>
    </div>
  );
}
