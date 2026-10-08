"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Tom, 1 Oct 2026: a search bar on every PC Command page to find a project.
 * Sits in the top bar (the layout), so it is the same box on Schedule,
 * Dashboard, Project Progress, Updates and Timesheets. Results come from
 * /pc/api/search — reference, job title, address, customer, estimate title
 * or number — and each hit opens the job's console page. ⌘K / Ctrl+K or "/"
 * focuses it, the same shortcuts the CRM search answers to.
 */
export type PcSearchHit = { id: string; title: string; line: string; stage: string; closed: boolean };

export default function PcSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PcSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const path = usePathname();

  // A navigation closes and clears the box (deferred — a synchronous setState
  // in an effect is a re-render for nothing).
  useEffect(() => {
    const t = setTimeout(() => { setOpen(false); setQ(""); setHits([]); }, 0);
    return () => clearTimeout(t);
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box.current?.focus(); box.current?.select(); }
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); box.current?.focus(); box.current?.select(); }
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
      if (needle.length < 2) { setHits([]); setFailed(false); return; }
      fetch(`/pc/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return (await r.json()) as { hits?: PcSearchHit[] };
        })
        .then((d) => { setHits(d.hits ?? []); setFailed(false); setActive(0); setOpen(true); })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          // A refused read is not "no project matches" — say so on the drop.
          setHits([]); setFailed(true); setOpen(true);
        });
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const hrefOf = (h: PcSearchHit) => `/pc/wo/${h.id}`;
  const shown = q.trim().length >= 2;

  return (
    <div className="gsearch" ref={wrap} role="search">
      <input
        ref={box}
        className="gsinput"
        type="search"
        placeholder="Find a project — reference, customer, address…  ⌘K"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => (hits.length || failed) && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && hits[active]) { window.location.href = hrefOf(hits[active]); }
        }}
        aria-label="Find a project"
        data-testid="pc-search"
      />
      {open && shown && (
        <div className="gsdrop" role="listbox" data-testid="pc-search-drop">
          {failed && <div className="gsempty" data-testid="pc-search-failed">Search isn&rsquo;t available just now — the read was refused.</div>}
          {!failed && hits.length === 0 && <div className="gsempty" data-testid="pc-search-empty">No project matches &ldquo;{q.trim()}&rdquo;.</div>}
          {hits.map((h, i) => (
            <Link key={h.id} href={hrefOf(h)} className={`gshit ${i === active ? "on" : ""}`} role="option" aria-selected={i === active} data-testid="pc-search-hit">
              <span className={`gskind${h.closed ? " off" : ""}`}>{h.stage}</span>
              <span className="gsmain"><b>{h.title}</b><small>{h.line}</small></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
