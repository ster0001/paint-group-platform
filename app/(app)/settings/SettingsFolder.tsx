"use client";

import { useState } from "react";

// A collapsible settings section — click the header to open it separately.
export default function SettingsFolder({
  title, subtitle, count, defaultOpen = false, children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-4 max-w-5xl rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="text-xl leading-none">{open ? "📂" : "📁"}</span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {subtitle && <span className="block text-xs text-gray-500">{subtitle}</span>}
        </span>
        {count != null && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{count}</span>}
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-gray-100 px-5 py-4">{children}</div>}
    </section>
  );
}
