"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Tom, 17 Sep: "a search bar at the top of the invoicing page to search
 * invoices by customer name or property address". Same shape as the
 * Estimates box: one needle on `?q=`, kept across the filter tabs, and the
 * page filters whatever the tab shows.
 */
export default function SearchBox({ q }: { q: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(q);
  const go = (next: string) => {
    const p = new URLSearchParams(params.toString());
    if (next.trim()) p.set("q", next.trim()); else p.delete("q");
    const qs = p.toString();
    router.push(`/invoices${qs ? `?${qs}` : ""}`);
  };
  // Tom, 29 Sep: "start searching automatically without a Search button".
  // A short pause after the last keystroke runs the search; Enter runs it at
  // once. `q` (from the URL) is the last needle that ran, so typing back to
  // it, or mounting with it, does not fire a redundant navigation.
  useEffect(() => {
    if (value.trim() === q.trim()) return;
    const t = setTimeout(() => go(value), 350);
    return () => clearTimeout(t);
    // go() reads router + params; both are stable for a given URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // The URL changed under us (a tab click keeps `q`, Clear drops it): follow
  // it — adjusted during render, the React-sanctioned shape for "state
  // derived from a prop that changed".
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) { setSeenQ(q); setValue(q); }
  return (
    <form className="flex items-center gap-2" role="search" data-testid="invoices-search" onSubmit={(e) => { e.preventDefault(); go(value); }}>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by customer or address"
        aria-label="Search invoices by customer name or property address"
        data-testid="invoices-search-input"
        className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
      />
      {q && (
        <button type="button" className="text-sm text-gray-500 hover:underline" data-testid="invoices-search-clear" onClick={() => { setValue(""); go(""); }}>Clear</button>
      )}
    </form>
  );
}
