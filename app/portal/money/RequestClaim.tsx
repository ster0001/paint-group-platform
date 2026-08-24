"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestClaimAction } from "./actions";

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ClaimableJob = {
  workOrderId: string;
  woRef: string;
  title: string;
  adjustedCents: number;   // offer + accepted additions − deductions
  invoicedCents: number;   // Σ submitted+ invoices
  deductionPending: boolean;
};

/**
 * "Send an invoice at any time" (Tom, 24 Aug): pick the job, pick a percent
 * of the contract or a dollar figure, see the exact cents before sending.
 * The preview is display-only — the server recomputes and bounds; the claim
 * is born submitted and the PDF renders behind the response.
 */
export default function RequestClaim({ jobs }: { jobs: ClaimableJob[] }) {
  const claimable = jobs.filter((j) => j.adjustedCents - j.invoicedCents > 0);
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(claimable[0]?.workOrderId ?? "");
  const [mode, setMode] = useState<"25" | "50" | "custom" | "fixed">("25");
  const [customPct, setCustomPct] = useState("");
  const [dollars, setDollars] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const job = claimable.find((j) => j.workOrderId === jobId) ?? claimable[0];
  const remaining = job ? job.adjustedCents - job.invoicedCents : 0;

  const previewCents = useMemo(() => {
    if (!job) return null;
    if (mode === "fixed") {
      const d = Number(dollars);
      return Number.isFinite(d) && d > 0 ? Math.round(d * 100) : null;
    }
    const pct = mode === "custom" ? Number(customPct) : Number(mode);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
    return Math.min(Math.round((job.adjustedCents * pct) / 100), remaining);
  }, [job, mode, customPct, dollars, remaining]);

  const overRemaining = mode === "fixed" && previewCents != null && previewCents > remaining;

  if (claimable.length === 0) return null;

  function submit() {
    if (!job || previewCents == null) return;
    setMessage(null);
    startTransition(async () => {
      const pct = mode === "custom" ? Number(customPct) : mode === "fixed" ? null : Number(mode);
      const result = await requestClaimAction({
        workOrderId: job.workOrderId,
        mode: mode === "fixed" ? "fixed" : "percent",
        value: mode === "fixed" ? Number(dollars) : pct!,
      });
      if (result.ok) {
        setOpen(false);
        setDollars(""); setCustomPct("");
        setMessage("Invoice sent — it's with the office, and your PDF is a tap away below.");
        router.refresh();
      } else setMessage(result.message);
    });
  }

  return (
    <div className="card" data-testid="request-claim">
      <div className="tick-head">
        <b>Invoice Paint Group</b>
        {!open && (
          <button type="button" className="var-add" onClick={() => setOpen(true)} data-testid="open-claim">
            + New invoice
          </button>
        )}
      </div>
      {message && <p className="hint" role="status" data-testid="claim-message" style={{ padding: 0 }}>{message}</p>}

      {open && job && (
        <div style={{ marginTop: 10 }}>
          {claimable.length > 1 && (
            <select
              value={job.workOrderId}
              onChange={(e) => setJobId(e.target.value)}
              data-testid="claim-job"
              style={{ width: "100%", marginBottom: 10, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            >
              {claimable.map((j) => (
                <option key={j.workOrderId} value={j.workOrderId}>
                  {j.title} · {j.woRef}
                </option>
              ))}
            </select>
          )}
          <p className="hint" style={{ padding: 0, margin: "0 0 8px" }}>
            {job.title} — contract {money(job.adjustedCents)}
            {job.invoicedCents > 0 ? ` · already invoiced ${money(job.invoicedCents)}` : ""}
            {" · "}<b>{money(remaining)} left to invoice</b>
          </p>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(["25", "50"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setMode(p)}
                className={`btn ${mode === p ? "cy" : "gh"}`} data-testid={`claim-pct-${p}`}>
                {p}%
              </button>
            ))}
            <button type="button" onClick={() => setMode("custom")}
              className={`btn ${mode === "custom" ? "cy" : "gh"}`} data-testid="claim-pct-custom">
              Custom %
            </button>
            <button type="button" onClick={() => setMode("fixed")}
              className={`btn ${mode === "fixed" ? "cy" : "gh"}`} data-testid="claim-fixed">
              $ amount
            </button>
          </div>

          {mode === "custom" && (
            <input type="number" min="1" max="100" inputMode="decimal" value={customPct}
              onChange={(e) => setCustomPct(e.target.value)} placeholder="% of contract"
              data-testid="claim-custom-pct"
              style={{ width: "100%", marginTop: 8, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 14 }} />
          )}
          {mode === "fixed" && (
            <input type="number" min="1" step="0.01" inputMode="decimal" value={dollars}
              onChange={(e) => setDollars(e.target.value)} placeholder="Amount in dollars"
              data-testid="claim-dollars"
              style={{ width: "100%", marginTop: 8, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 14 }} />
          )}

          <button type="button" className="btn cy" disabled={pending || previewCents == null || overRemaining}
            onClick={submit} data-testid="send-claim" style={{ marginTop: 10, width: "100%" }}>
            {pending ? "Sending…"
              : overRemaining ? `Only ${money(remaining)} left to invoice`
              : previewCents != null ? `Send invoice — ${money(previewCents)}`
              : "Pick an amount"}
          </button>
          <button type="button" className="btn dim" onClick={() => setOpen(false)} style={{ marginTop: 6, width: "100%" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
