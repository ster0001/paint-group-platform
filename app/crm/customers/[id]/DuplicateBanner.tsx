"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeAccounts } from "../../recordActions";

/**
 * P2 — "possibly the same person": the duplicate finder narrowed to this
 * record (same phone, email or address). One button merges the other record
 * into this one; the merge moves everything and logs itself on the timeline.
 */
export type DuplicateHit = { otherId: string; otherName: string; reason: string };

const WHY: Record<string, string> = { phone: "same phone", email: "same email", address: "same address" };

export default function DuplicateBanner({ keepId, hits }: { keepId: string; hits: DuplicateHit[] }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  if (hits.length === 0) return null;

  const merge = (h: DuplicateHit) => start(async () => {
    if (!window.confirm(`Merge "${h.otherName}" into this record? Their estimates, jobs, invoices and history move here and their record is deleted.`)) return;
    const r = await mergeAccounts(keepId, h.otherId);
    if (!r.ok) { setError(r.message); return; }
    router.refresh();
  });

  return (
    <div className="dupbanner" data-testid="dup-banner">
      <b>Possibly the same person.</b>
      {hits.map((h) => (
        <span key={h.otherId} className="duphit">
          <Link href={`/crm/customers/${h.otherId}`}>{h.otherName}</Link> <i>({WHY[h.reason] ?? h.reason})</i>
          <button className="chip sm" disabled={busy} onClick={() => merge(h)} data-testid="merge-dup">Merge into this record</button>
        </span>
      ))}
      {error && <span className="said bad">{error}</span>}
    </div>
  );
}
