"use client";

import { useState } from "react";
import Link from "next/link";

export type TemplateMeta = { id: string; name: string };

// "New estimate" that first asks: blank, or from a saved template.
export default function NewEstimateButton({ templates }: { templates: TemplateMeta[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        + New estimate
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-semibold">New estimate</h2>
              <button onClick={() => setOpen(false)} className="px-2 py-1 text-2xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
            </div>

            <div className="px-5 py-4">
              <Link
                href="/wizard"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 rounded-xl border border-gray-200 p-4 text-left hover:border-gray-900 hover:bg-gray-50"
              >
                <span className="text-2xl">🪄</span>
                <span>
                  <span className="block text-sm font-medium">Start with the wizard</span>
                  <span className="block text-xs text-gray-500">Floorplan, listing URL or quick basics → a priced draft.</span>
                </span>
              </Link>

              <Link
                href="/quote"
                onClick={() => setOpen(false)}
                className="mt-2 flex w-full items-center gap-3 rounded-xl border border-gray-200 p-4 text-left hover:border-gray-900 hover:bg-gray-50"
              >
                <span className="text-2xl">📄</span>
                <span>
                  <span className="block text-sm font-medium">Blank estimate</span>
                  <span className="block text-xs text-gray-500">Start from scratch.</span>
                </span>
              </Link>

              <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">From a template</div>
              {templates.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No templates yet. Open an estimate and use <span className="font-medium">Save as template</span> to create one.
                </p>
              ) : (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <Link
                      key={t.id}
                      href={`/quote?template=${t.id}`}
                      onClick={() => setOpen(false)}
                      className="flex w-full items-center gap-3 rounded-xl border border-gray-200 p-3 text-left hover:border-gray-900 hover:bg-gray-50"
                    >
                      <span className="text-xl">📁</span>
                      <span className="text-sm font-medium">{t.name || "Untitled template"}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
