"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The Settings page's frame (Tom, 3 Sep 2026: "tidy up the settings page into
 * buckets to make it easier to find information").
 *
 * Six buckets, each a titled section of folders. A sticky bar of bucket links
 * jumps down the page; a search box narrows the folders by name or blurb
 * across every bucket. `#<folder-id>` in the URL opens that folder and
 * scrolls to it, so other screens can deep-link ("Settings → Automations").
 *
 * The folders' CONTENT is rendered by the server page and passed in as
 * React nodes — this shell only decides what is shown and where.
 */
export type SettingsFolderDef = {
  id: string;
  title: string;
  subtitle?: string;
  count?: number;
  defaultOpen?: boolean;
  content: ReactNode;
};

export type SettingsBucketDef = {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  folders: SettingsFolderDef[];
};

export default function SettingsShell({ buckets }: { buckets: SettingsBucketDef[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(buckets.flatMap((b) => b.folders.map((f) => [f.id, Boolean(f.defaultOpen)]))),
  );

  // Deep link: /settings#automations opens that folder and scrolls to it.
  useEffect(() => {
    const apply = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      if (buckets.some((b) => b.folders.some((f) => f.id === id))) {
        setOpen((o) => ({ ...o, [id]: true }));
        window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [buckets]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return buckets;
    return buckets
      .map((b) => ({
        ...b,
        folders: b.folders.filter((f) =>
          `${f.title} ${f.subtitle ?? ""} ${b.title}`.toLowerCase().includes(needle)),
      }))
      .filter((b) => b.folders.length > 0);
  }, [buckets, needle]);

  const jump = (bucketId: string) => {
    document.getElementById(`bucket-${bucketId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div>
      {/* ---- sticky bucket bar + search ------------------------------------ */}
      <div className="sticky top-0 z-20 -mx-6 border-b border-gray-200 bg-gray-50/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-1.5" aria-label="Settings sections">
            {buckets.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => jump(b.id)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900"
              >
                <span aria-hidden className="mr-1">{b.icon}</span>{b.title}
              </button>
            ))}
          </nav>
          <label className="ml-auto flex min-w-[14rem] items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-500">
            <span aria-hidden>🔎</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a setting…"
              aria-label="Find a setting"
              className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              data-testid="settings-search"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-gray-400 hover:text-gray-700" aria-label="Clear search">×</button>
            )}
          </label>
        </div>
      </div>

      {visible.length === 0 && (
        <p className="mt-8 text-sm text-gray-500">Nothing matches “{q}”. Try another word — folders are searched by name and description.</p>
      )}

      {/* ---- the buckets ---------------------------------------------------- */}
      {visible.map((b) => (
        <section key={b.id} id={`bucket-${b.id}`} className="mt-8 scroll-mt-20 max-w-5xl" data-testid={`bucket-${b.id}`}>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-base font-semibold tracking-tight text-gray-900">
              <span aria-hidden className="mr-2">{b.icon}</span>{b.title}
            </h2>
            <p className="text-sm text-gray-500">{b.blurb}</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
            {b.folders.map((f) => {
              const isOpen = Boolean(open[f.id]);
              return (
                <div key={f.id} id={f.id} className="scroll-mt-20" data-testid={`folder-${f.id}`}>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [f.id]: !o[f.id] }))}
                    aria-expanded={isOpen}
                    className={`flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 ${isOpen ? "bg-gray-50" : ""}`}
                  >
                    <span className={`text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>▸</span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-gray-900">{f.title}</span>
                      {f.subtitle && <span className="block text-xs text-gray-500">{f.subtitle}</span>}
                    </span>
                    {f.count != null && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{f.count}</span>
                    )}
                  </button>
                  {isOpen && <div className="border-t border-gray-100 bg-white px-5 py-4">{f.content}</div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
