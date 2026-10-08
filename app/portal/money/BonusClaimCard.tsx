"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimBonusAction } from "../bonusActions";

/**
 * The approved bonus, with its amount and one button (Tom, 8 Oct 2026). A
 * contractor claims it — the claim raises their invoice. An employed lead sees
 * the amount and that it goes on the next pay run; nothing to press.
 */
export default function BonusClaimCard({ bonuses, employee }: { bonuses: { id: string; amountCents: number; decidedAt: string | null }[]; employee: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (bonuses.length === 0) return null;
  const money = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="card greenish" data-testid="bonus-claim-card">
      <h3>Bonus approved</h3>
      {bonuses.map((b) => (
        <div key={b.id} className="row" style={{ justifyContent: "space-between", marginTop: 8 }} data-testid={`bonus-claim-${b.id}`}>
          <div>
            <b style={{ fontFamily: "var(--mono, monospace)", fontSize: 18 }} data-testid={`bonus-claim-amount-${b.id}`}>{money(b.amountCents)}</b>
            <div className="small muted">For your clean work on Green{b.decidedAt ? ` · approved ${new Date(b.decidedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" })}` : ""}</div>
            {employee && <div className="small">It will be in your next pay run.</div>}
          </div>
          {!employee && (
            <button type="button" className="btn cy" disabled={pending} data-testid={`bonus-claim-button-${b.id}`}
              onClick={() => start(async () => {
                setMsg(null);
                const r = await claimBonusAction({ bonusId: b.id });
                setMsg(r.message);
                if (r.ok) router.refresh();
              })}>
              {pending ? "…" : "Claim now"}
            </button>
          )}
        </div>
      ))}
      {msg && <p className="small" style={{ marginTop: 8 }} data-testid="bonus-claim-msg">{msg}</p>}
    </div>
  );
}
