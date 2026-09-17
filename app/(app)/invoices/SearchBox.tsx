"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

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
      <button type="submit" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" data-testid="invoices-search-go">Search</button>
      {q && (
        <button type="button" className="text-sm text-gray-500 hover:underline" data-testid="invoices-search-clear" onClick={() => { setValue(""); go(""); }}>Clear</button>
      )}
    </form>
  );
}
