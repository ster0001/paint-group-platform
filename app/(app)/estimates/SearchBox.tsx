"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { hrefWithNeedle, useSearchNeedle } from "./useSearchNeedle";

/**
 * Tom, 15 Sep: "a search bar on the estimates page, to be able to type by
 * customer name, or address to find the project". One box, kept across the
 * tabs (`?q=`); the tab's table filters whatever it shows.
 *
 * Tom, 23 Oct 2026: "it crashes and retypes as you are typing". Each pause
 * used to `router.push` a new `?q=`: the App Router keys the page by its
 * search params, so the whole page gave way to the loading skeleton and came
 * back with a NEW box holding the needle from 350 ms ago — focus gone, the
 * letters typed in between gone. The needle never changed what the server
 * read, only what it kept, so the filter now runs on the client
 * (`lib/estimate/search.ts`, through the three tables) and this box only
 * writes `?q=` into the URL with `history.replaceState`, which Next feeds
 * straight into `useSearchParams` with no request, no skeleton and no remount.
 * Deep links (`/estimates?q=…`) still paint filtered on the server.
 */
export default function SearchBox() {
  const params = useSearchParams();
  const q = useSearchNeedle();
  const [value, setValue] = useState(q);
  // A HONEST GO-SIGNAL (18 Sep 2026). Clear is `type="button"`: before React
  // attaches, clicking it does nothing at all — no error, no navigation — so a
  // test (or an impatient person) that presses it early is simply ignored and
  // the needle stays in the URL. `data-ready` is the same hook the wizard uses.
  // Set on the frame AFTER mount, not synchronously in the effect.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const write = (next: string) => {
    setValue(next);
    if (typeof window === "undefined") return;
    const href = hrefWithNeedle(params, next);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  };
  // The URL changed under us (back button, a tab click that kept `q`, a link):
  // follow it — adjusted during render, the React-sanctioned shape for "state
  // derived from a prop that changed". Our own writes trim, so a needle being
  // typed with a trailing space is left exactly as typed.
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) { setSeenQ(q); if (value.trim() !== q) setValue(q); }
  return (
    <form className="flex items-center gap-2" role="search" data-testid="estimates-search" data-ready={ready ? "1" : undefined} onSubmit={(e) => { e.preventDefault(); write(value); }}>
      <input
        type="search"
        value={value}
        onChange={(e) => write(e.target.value)}
        placeholder="Search by customer or address"
        aria-label="Search estimates by customer name or address"
        data-testid="estimates-search-input"
        className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
      />
      {q && (
        <button type="button" className="text-sm text-gray-500 hover:underline" data-testid="estimates-search-clear" onClick={() => write("")}>Clear</button>
      )}
    </form>
  );
}
