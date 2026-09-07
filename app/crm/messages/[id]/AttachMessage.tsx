"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachMessage } from "../../recordActions";
import type { SearchHit } from "../../Search";

/** Search the customers, pick one, attach. Same search the top bar uses. */
export default function AttachMessage({ messageId, hint }: { messageId: string; hint: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const needle = q.trim();
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      if (needle.length < 2) { setHits([]); return; }
      fetch(`/crm/api/search?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d) => setHits((d.hits ?? []).filter((h: SearchHit) => h.kind === "account")))
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const attach = (accountId: string) => start(async () => {
    const r = await attachMessage(messageId, accountId);
    if (!r.ok) { setError(r.message); return; }
    router.push(`/crm/customers/${accountId}#messages`);
  });

  return (
    <div className="attach" data-testid="attach">
      <input className="field" placeholder={hint ? `Search — e.g. part of "${hint}"` : "Name, phone, email…"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" autoFocus />
      {hits.map((h) => h.kind === "account" && (
        <div key={h.id} className="attachhit">
          <span><b>{h.name}</b><br /><small style={{ color: "var(--muted)" }}>{h.line}</small></span>
          <button type="button" className="chip sm" disabled={busy} onClick={() => attach(h.id)}>Attach to {h.name.split(" ")[0]}</button>
        </div>
      ))}
      {error && <span className="said bad">{error}</span>}
    </div>
  );
}
