"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Search and "Show paid jobs" (§4.2) — both live in the URL so a filtered view
 * can be shared. The only client code on the page; it holds no money.
 */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(initial);
  const first = useRef(true);
  // The latest params, read when the timer fires — so the effect re-runs on typing only.
  const latest = useRef(params);
  useEffect(() => { latest.current = params; }, [params]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const next = new URLSearchParams(latest.current.toString());
      if (q.trim()) next.set("q", q.trim()); else next.delete("q");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, 350);
    return () => clearTimeout(t);
  }, [q, pathname, router]);
  return (
    <input className="search" type="search" placeholder="Search address or customer" aria-label="Search address or customer"
      value={q} onChange={(e) => setQ(e.target.value)} />
  );
}

export function ShowPaid({ on }: { on: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="chk">
      <input type="checkbox" checked={on} onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.checked) next.set("paid", "1"); else next.delete("paid");
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }} /> Show paid jobs
    </label>
  );
}
