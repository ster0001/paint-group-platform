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
export default function RequestClaim({ jobs, defaultOpen = false, heading = "Invoice Paint Group" }: {
  jobs: ClaimableJob[];
  /** Open the form immediately (the per-job card on the job screen). */
  defaultOpen?: boolean;
  heading?: string;
}) {
  const claimable = jobs.filter((j) => j.adjustedCents - j.invoicedCents > 0);
  const [open, setOpen] = useState(defaultOpen && claimable.length > 0);
  // Tom (25 Aug): with more than one claimable job, the job is PICKED, never
  // assumed — an invoice must not default onto the wrong address.
  const [jobId, setJobId] = useState(claimable.length === 1 ? claimable[0].workOrderId : "");
  const [mode, setMode] = useState<"25" | "50" | "custom" | "fixed">("25");
  const [customPct, setCustomPct] = useState("");
  const [dollars, setDollars] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const job = claimable.find((j) => j.workOrderId === jobId) ?? (claimable.length === 1 ? claimable[0] : null);
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

  // The card ALWAYS shows (Tom, 25 Aug: "the payments tab still isn't
  // working" was this card hiding itself) — with the honest reason when
  // there's nothing to claim.
  if (claimable.length === 0) {
    return (
      <div className="card" data-testid="request-claim">
        <div className="tick-head"><b>{heading}</b></div>
        <p className="hint" style={{ padding: 0 }} data-testid="claim-empty">
          Nothing left to invoice right now — your jobs are either fully
          invoiced or don&rsquo;t have an agreed amount recorded yet. The moment a
          job of yours has money owing, the <b>+ New invoice</b> button appears here.
        </p>
      </div>
    );
  }

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
        <b>{heading}</b>
        {!open && (
          <button type="button" className="var-add" onClick={() => setOpen(true)} data-testid="open-claim">
            + New invoice
          </button>
        )}
      </div>
      {message && <p className="hint" role="status" data-testid="claim-message" style={{ padding: 0 }}>{message}</p>}

      {open && (
        <div style={{ marginTop: 10 }}>
          {claimable.length > 1 && (
            <select
              value={job?.workOrderId ?? ""}
              onChange={(e) => setJobId(e.target.value)}
              data-testid="claim-job"
              style={{ width: "100%", marginBottom: 10, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 14 }}
            >
              <option value="" disabled>— pick the job this invoice is for —</option>
              {claimable.map((j) => (
                <option key={j.workOrderId} value={j.workOrderId}>
                  {j.title} · {j.woRef}
                </option>
              ))}
            </select>
          )}
          {job ? (
            <p className="hint" style={{ padding: 0, margin: "0 0 8px" }}>
              {job.title} — contract {money(job.adjustedCents)}
              {job.invoicedCents > 0 ? ` · already invoiced ${money(job.invoicedCents)}` : ""}
              {" · "}<b>{money(remaining)} left to invoice</b>
            </p>
          ) : (
            <p className="hint" style={{ padding: 0, margin: "0 0 8px" }}>
              Pick the job above first — the invoice attaches to it.
            </p>
          )}

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
