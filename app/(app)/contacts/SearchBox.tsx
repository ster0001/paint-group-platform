"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Tom, 1 Oct 2026: "a search bar in the contact page to search from existing
 * contacts". One box; the page filters on the server (`?q=`) by name,
 * company, email, phone or suburb. Same shape as the Estimates search: a
 * short pause after the last keystroke runs it, Enter runs it at once, and
 * `data-ready` says when Clear is wired (it is a plain button before React
 * attaches, so an early click would be silently ignored).
 */
export default function SearchBox({ q }: { q: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const go = (next: string) => {
    const needle = next.trim();
    router.push(needle ? `/contacts?q=${encodeURIComponent(needle)}` : "/contacts");
  };
  useEffect(() => {
    if (value.trim() === q.trim()) return;
    const t = setTimeout(() => go(value), 350);
    return () => clearTimeout(t);
    // go() reads the router, which is stable for a given URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // The URL changed under us (Clear drops `q`): follow it, adjusted during render.
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) { setSeenQ(q); setValue(q); }
  return (
    <form className="flex items-center gap-2" role="search" data-testid="contacts-search" data-ready={ready ? "1" : undefined} onSubmit={(e) => { e.preventDefault(); go(value); }}>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by name, company, email, phone or suburb"
        aria-label="Search contacts"
        data-testid="contacts-search-input"
        className="w-80 max-w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-900 focus:outline-none"
      />
      {q && (
        <button type="button" className="text-sm text-gray-500 hover:underline" data-testid="contacts-search-clear" onClick={() => { setValue(""); go(""); }}>Clear</button>
      )}
    </form>
  );
}
