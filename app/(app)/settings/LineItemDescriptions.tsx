"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RichTextEditor from "@/app/components/RichTextEditor";

export type LineItemRow = { id: string; name: string; type: string | null; description: string | null };

// Staff-editable descriptions for each line-item template. Editing here updates
// line_items.description; the estimate builder loads this text into the line
// item's rich-text box when the template is chosen.
export default function LineItemDescriptions({ initial }: { initial: LineItemRow[] }) {
  const [rows, setRows] = useState<LineItemRow[]>(initial);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const setDesc = (id: string, description: string) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, description } : r)));

  async function save(row: LineItemRow) {
    setSavingId(row.id);
    setMsg((m) => ({ ...m, [row.id]: "" }));
    const supabase = createClient();
    const { error } = await supabase.from("line_items").update({ description: row.description ?? "" }).eq("id", row.id);
    setSavingId(null);
    setMsg((m) => ({ ...m, [row.id]: error ? error.message : "Saved ✓" }));
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-6 max-w-2xl rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold">Line item descriptions</h2>
      <p className="mt-1 text-sm text-gray-500">
        These are the pre-written descriptions the customer sees. When you add a line item to an estimate, this text is
        loaded into its description box — you can still tweak it per estimate.
      </p>

      <div className="mt-4 divide-y divide-gray-100">
        {rows.map((r) => {
          const open = openId === r.id;
          return (
            <div key={r.id} className="py-2">
              <button
                onClick={() => setOpenId(open ? null : r.id)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="text-gray-400">{open ? "▾" : "▸"}</span>
                <span className="font-medium">{r.name}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">{r.type}</span>
                {!r.description && <span className="text-[11px] text-amber-600">no description</span>}
                {msg[r.id]?.startsWith("Saved") && <span className="ml-auto text-xs text-green-600">Saved ✓</span>}
              </button>

              {open && (
                <div className="mt-2 pl-6">
                  <RichTextEditor
                    value={r.description ?? ""}
                    onChange={(html) => setDesc(r.id, html)}
                    placeholder="Description shown to the customer…"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => save(r)}
                      disabled={savingId === r.id}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      {savingId === r.id ? "Saving…" : "Save"}
                    </button>
                    {msg[r.id] && (
                      <span className={`text-sm ${msg[r.id].startsWith("Saved") ? "text-green-600" : "text-red-600"}`}>{msg[r.id]}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
