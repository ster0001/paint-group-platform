"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * P2 — global search in the CRM's top bar: name, phone, email, address, or an
 * estimate's title. ⌘K / Ctrl+K focuses it from anywhere. Results come from
 * /crm/api/search (the facts table + estimates), so a 10,000-customer office
 * gets an answer in the time it takes to type.
 */
export type SearchHit =
  | { kind: "account"; id: string; name: string; line: string; stage: string }
  | { kind: "estimate"; id: string; accountId: string | null; title: string; line: string };

export default function Search() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const path = usePathname();

  // A navigation closes and clears the box (deferred: the lint rule is right
  // that a synchronous setState in an effect is a re-render for nothing).
  useEffect(() => {
    const t = setTimeout(() => { setOpen(false); setQ(""); setHits([]); }, 0);
    return () => clearTimeout(t);
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box.current?.focus(); box.current?.select(); }
    };
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, []);

  useEffect(() => {
    const needle = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (needle.length < 2) { setHits([]); return; }
      fetch(`/crm/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d) => { setHits(d.hits ?? []); setActive(0); setOpen(true); })
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const hrefOf = (h: SearchHit) => (h.kind === "account" ? `/crm/customers/${h.id}` : `/quote?id=${h.id}`);

  return (
    <div className="gsearch" ref={wrap}>
      <input
        ref={box}
        className="field gsinput"
        type="search"
        placeholder="Search customers, phones, addresses…  ⌘K"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && hits[active]) { window.location.href = hrefOf(hits[active]); }
        }}
        aria-label="Search the CRM"
        data-testid="global-search"
      />
      {open && q.trim().length >= 2 && (
        <div className="gsdrop" role="listbox">
          {hits.length === 0 && <div className="gsempty">Nobody matches “{q.trim()}”.</div>}
          {hits.map((h, i) => (
            <Link key={`${h.kind}:${h.id}`} href={hrefOf(h)} className={`gshit ${i === active ? "on" : ""}`} role="option" aria-selected={i === active}>
              <span className="gskind">{h.kind === "account" ? "Customer" : "Estimate"}</span>
              <span className="gsmain"><b>{h.kind === "account" ? h.name : h.title}</b><small>{h.line}</small></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
