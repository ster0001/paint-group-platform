"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Session 6 · The colour card's "where to buy" line (⚑7): brand + nearest
 * trade centre/retailer, printed on every downloadable colour card so the
 * client can buy their own touch-up paint. One global Settings value.
 */
export default function ColourCardSettings() {
  const [value, setValue] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    createClient().from("settings").select("value").eq("key", "colour_card").maybeSingle()
      .then(({ data }) => setValue(((data?.value ?? {}) as { whereToBuy?: string }).whereToBuy ?? ""));
  }, []);

  const save = async () => {
    setMsg("");
    const { error } = await createClient().from("settings")
      .upsert({ key: "colour_card", value: { whereToBuy: value ?? "" } }, { onConflict: "key" });
    setMsg(error ? `Couldn't save: ${error.message}` : "Saved ✓");
  };

  if (value === null) return <p className="text-xs text-gray-400">Loading…</p>;
  return (
    <div className="space-y-2 text-sm">
      <label className="block text-xs font-semibold text-gray-600">
        &quot;Where to buy&quot; line on the colour card PDF
      </label>
      <textarea
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        rows={2}
        placeholder="e.g. Dulux Trade Centre Moorabbin, 14 Levida Dr — quote the colour codes on this card."
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white" onClick={save}>Save</button>
        <span className="text-xs text-gray-500">{msg || "Never includes our trade account number or trade pricing."}</span>
      </div>
    </div>
  );
}
