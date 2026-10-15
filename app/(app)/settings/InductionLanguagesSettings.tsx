"use client";

import { useState, useTransition } from "react";
import { setLanguageLiveAction } from "./inductionActions";
import type { LanguageRow } from "@/lib/induction/languages";

/**
 * Settings → Communications → Induction languages (induction brief Step 4,
 * ⚑3). One row per language with its live switch. A language is offered to
 * painters only when live; English cannot be switched off. The wording
 * itself lives in docs/induction/translations/<code>.json and is loaded by
 * scripts/seed-induction.ts — this switch never edits words.
 */
export default function InductionLanguagesSettings({ initial, counts, loadError }: { initial: LanguageRow[]; counts: Record<string, number>; loadError: string | null }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function toggle(code: string, live: boolean) {
    setMsg("");
    start(async () => {
      const r = await setLanguageLiveAction({ code, live });
      if (!r.ok) { setMsg(r.message); return; }
      setRows((rs) => rs.map((x) => (x.code === code ? { ...x, live: r.live } : x)));
      setMsg(`${code}: ${r.live ? "live" : "off"} ✓`);
    });
  }

  return (
    <div className="space-y-3" data-testid="induction-languages">
      {loadError && <p className="text-sm text-amber-700" role="status">The language list could not be read: {loadError}</p>}
      <p className="text-xs text-gray-500">
        What a painter reads and ticks in the induction, and the six standards sections, are served in the language they choose. Switch a language on here once Tom&rsquo;s team has tested its wording. Off means it is not offered; a painter who already chose it keeps reading English until it is on again. The slides, the app and the demo job stay English (ruling I8).
      </p>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
        {rows.map((l) => (
          <li key={l.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`induction-language-${l.code}`}>
            <span>
              <span className="font-medium text-gray-900" lang={l.code} dir={l.dir}>{l.native_name}</span>
              <span className="ml-2 text-gray-500">{l.name} · {l.code}{l.dir === "rtl" ? " · right-to-left" : ""}</span>
              <span className="block text-xs text-gray-500">{counts[l.code] ? `${counts[l.code]} painter${counts[l.code] === 1 ? "" : "s"} reading in it` : "no painter reading in it yet"}</span>
            </span>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" role="switch" checked={l.live} disabled={pending || l.code === "en"} onChange={(e) => toggle(l.code, e.target.checked)}
                aria-label={`${l.name} live`} data-testid={`induction-language-live-${l.code}`} className="h-4 w-4 accent-emerald-600" />
              <span className={l.live ? "text-emerald-700" : "text-gray-400"}>{l.live ? "Live" : "Off"}</span>
            </label>
          </li>
        ))}
      </ul>
      {msg && <p className="text-xs text-gray-600" role="status" data-testid="induction-languages-msg">{msg}</p>}
    </div>
  );
}
