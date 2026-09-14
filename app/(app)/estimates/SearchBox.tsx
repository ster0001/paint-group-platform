"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Tom, 15 Sep: "a search bar on the estimates page, to be able to type by
 * customer name, or address to find the project". One box, kept across the
 * tabs (`?q=`); the page filters whatever the tab shows.
 */
export default function SearchBox({ q }: { q: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(q);
  const go = (next: string) => {
    const p = new URLSearchParams(params.toString());
    if (next.trim()) p.set("q", next.trim()); else p.delete("q");
    const qs = p.toString();
    router.push(`/estimates${qs ? `?${qs}` : ""}`);
  };
  return (
    <form className="flex items-center gap-2" role="search" data-testid="estimates-search" onSubmit={(e) => { e.preventDefault(); go(value); }}>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by customer or address"
        aria-label="Search estimates by customer name or address"
        data-testid="estimates-search-input"
        className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
      />
      <button type="submit" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" data-testid="estimates-search-go">Search</button>
      {q && (
        <button type="button" className="text-sm text-gray-500 hover:underline" data-testid="estimates-search-clear" onClick={() => { setValue(""); go(""); }}>Clear</button>
      )}
    </form>
  );
}
