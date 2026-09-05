"use client";

import { useMemo, useState } from "react";
import { AUDIENCES, type Audience } from "@/lib/marketing/audience";
import { SECTIONS, SECTION_FIELDS, SECTION_LABEL, type SiteCopy } from "@/lib/marketing/copy/schema";
import { saveSiteContentAction } from "./siteContentActions";

/**
 * Settings → Website → Site copy (session 8 §3). Two tabs (Homes /
 * Businesses), the sections in page order, every key a labelled field, and
 * a live preview of the real homepage for that audience beside it (the
 * business page lives at /business here). Markdown keys are plain
 * textareas; no rich text. Save writes only what changed.
 */
export default function SiteCopyEditor({ initial, businessHref }: { initial: Record<Audience, SiteCopy>; businessHref: string }) {
  const [tab, setTab] = useState<Audience>("home");
  const [copy, setCopy] = useState<Record<Audience, SiteCopy>>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [open, setOpen] = useState<string>("hero");

  const previewSrc = useMemo(() => (tab === "home" ? "/" : businessHref) + `?preview=${previewKey}`, [tab, businessHref, previewKey]);

  const set = (section: string, key: string, value: string) => {
    setCopy((c) => ({ ...c, [tab]: { ...c[tab], [section]: { ...c[tab][section as keyof SiteCopy], [key]: value } } }));
    setDirty((d) => new Set(d).add(`${tab}:${section}.${key}`));
  };

  async function save() {
    setBusy(true); setMsg(null);
    const entries = [...dirty].filter((k) => k.startsWith(`${tab}:`)).map((k) => {
      const [section, key] = k.slice(tab.length + 1).split(".");
      return { section, key, value: copy[tab][section as keyof SiteCopy][key] ?? "" };
    });
    const r = await saveSiteContentAction({ audience: tab, entries }).catch(() => null);
    setBusy(false);
    if (!r || r.status === "error") { setMsg({ ok: false, text: r?.status === "error" ? r.message : "That didn't save." }); return; }
    setDirty((d) => new Set([...d].filter((k) => !k.startsWith(`${tab}:`))));
    setMsg({ ok: true, text: r.count === 0 ? "Nothing changed." : `Saved ${r.count} field${r.count === 1 ? "" : "s"}. Live on the website within a minute.` });
    setPreviewKey((k) => k + 1);
  }

  const input = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";
  const dirtyCount = [...dirty].filter((k) => k.startsWith(`${tab}:`)).length;

  return (
    <div className="grid gap-4" data-testid="site-copy">
      <div className="flex flex-wrap items-center gap-2">
        {AUDIENCES.map((a) => (
          <button key={a} type="button" onClick={() => setTab(a)} data-testid={`copy-tab-${a}`}
            className={`rounded-full border px-3 py-1.5 text-sm ${tab === a ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
            {a === "home" ? "Homes" : "Businesses"}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">{dirtyCount ? `${dirtyCount} unsaved` : "All saved"}</span>
        <button type="button" onClick={save} disabled={busy || dirtyCount === 0} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50" data-testid="copy-save">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`} data-testid="copy-status">{msg.text}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-2 self-start">
          {SECTIONS.map((section) => (
            <details key={section} open={open === section} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpen(section); }} className="rounded-lg border border-gray-200 bg-white" data-testid={`copy-section-${section}`}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-800">{SECTION_LABEL[section]}</summary>
              <div className="grid gap-3 border-t border-gray-100 px-3 py-3">
                {SECTION_FIELDS[section].map((f) => {
                  const value = copy[tab][section][f.key] ?? "";
                  const id = `${tab}-${section}-${f.key}`;
                  return (
                    <label key={f.key} htmlFor={id} className="text-xs text-gray-600">
                      {f.label}{f.kind === "markdown" && <span className="ml-1 text-gray-400">(markdown: **bold**, [links](url), blank line = paragraph)</span>}
                      {f.kind === "text"
                        ? <input id={id} className={`mt-1 ${input}`} value={value} onChange={(e) => set(section, f.key, e.target.value)} data-testid={`copy-${section}-${f.key}`} />
                        : <textarea id={id} className={`mt-1 min-h-[72px] ${input}`} value={value} onChange={(e) => set(section, f.key, e.target.value)} data-testid={`copy-${section}-${f.key}`} />}
                    </label>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
        <div className="self-start lg:sticky lg:top-4">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>Live preview: {tab === "home" ? "homes site" : "business site"}</span>
            <a href={previewSrc.split("?")[0]} target="_blank" rel="noopener noreferrer" className="underline">Open in a tab</a>
          </div>
          <iframe key={previewSrc} src={previewSrc} title="Homepage preview" className="h-[70vh] w-full rounded-lg border border-gray-200 bg-white" data-testid="copy-preview" />
        </div>
      </div>
    </div>
  );
}
