"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLanguageAction } from "./actions";
import type { Dir, LanguageCode } from "@/lib/induction/languages";

export type PickerLanguage = { code: LanguageCode; name: string; nativeName: string; dir: Dir };

/**
 * The first screen of the induction (Module 1, "On your phone" step 1): one
 * button per language staff have switched on, the native name large, the
 * English name small. Saving sends the painter on to `next`. The current
 * choice is marked so a painter changing their mind sees where they are.
 */
export default function LanguagePicker({ languages, current, next }: { languages: PickerLanguage[]; current: LanguageCode | null; next: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function pick(code: LanguageCode) {
    setBusy(code); setMessage(null);
    start(async () => {
      const r = await setLanguageAction({ code });
      if (!r.ok) { setMessage(r.message); setBusy(null); return; }
      router.push(next);
      router.refresh();
    });
  }

  return (
    <div data-testid="language-picker">
      <div style={{ display: "grid", gap: 8 }}>
        {languages.map((l) => (
          <button key={l.code} type="button" className={`act ${current === l.code ? "on" : ""}`} disabled={pending} onClick={() => pick(l.code)}
            data-testid={`language-${l.code}`} aria-pressed={current === l.code}
            style={{ width: "100%", textAlign: "start", border: current === l.code ? "1px solid var(--cyan)" : undefined }}>
            <span lang={l.code} dir={l.dir} style={{ fontSize: 17, fontWeight: 600 }}>{l.nativeName}</span>
            <span className="push" style={{ fontSize: 12, color: "var(--muted)" }}>{busy === l.code ? "Saving…" : l.name}{current === l.code ? " · chosen" : ""}</span>
          </button>
        ))}
      </div>
      {message && <p className="err" role="alert" data-testid="language-error" style={{ marginTop: 10 }}>{message}</p>}
    </div>
  );
}
