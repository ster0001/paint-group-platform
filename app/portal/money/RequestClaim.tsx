"use client";

import { money } from "@/lib/format/money";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestClaimAction } from "./actions";


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
/**
 * What this claim would come to, in cents — or null while the form is not yet
 * answerable. Pure: same inputs, same number, no clock and no state.
 *
 * It lives outside the component because the React Compiler could not preserve
 * the `useMemo` this replaces: `job` is derived during render, so the compiler
 * refused to optimise the whole component (F1, lint error 3 of 3). A plain
 * function needs no memo — the compiler handles it — and the arithmetic stops
 * sitting inside a component, which is the direction A2-01 wants anyway.
 *
 * The server still bounds the money. This only decides what the contractor
 * sees before they submit.
 */
function claimPreviewCents(
  job: { adjustedCents: number } | null,
  mode: string,
  items: readonly { label: string; dollars: string }[],
  dollars: string,
  customPct: string,
  remaining: number,
): number | null {
  if (!job) return null;
  if (mode === "items") {
    const sum = items.reduce((n, r) => n + (Number(r.dollars) > 0 ? Math.round(Number(r.dollars) * 100) : 0), 0);
    const complete = items.length > 0 && items.every((r) => r.label.trim() && Number(r.dollars) > 0);
    return complete && sum > 0 ? sum : null;
  }
  if (mode === "fixed") {
    const d = Number(dollars);
    return Number.isFinite(d) && d > 0 ? Math.round(d * 100) : null;
  }
  const pct = mode === "custom" ? Number(customPct) : Number(mode);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return Math.min(Math.round((job.adjustedCents * pct) / 100), remaining);
}

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
  const [mode, setMode] = useState<"25" | "50" | "custom" | "fixed" | "items">("25");
  const [customPct, setCustomPct] = useState("");
  const [dollars, setDollars] = useState("");
  // Their own line items + invoice date (Tom, 25 Aug) — the invoice is THEIRS:
  // they control what it says; the server only bounds the money.
  const [items, setItems] = useState<{ label: string; dollars: string }[]>([{ label: "", dollars: "" }]);
  const [invDate, setInvDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const job = claimable.find((j) => j.workOrderId === jobId) ?? (claimable.length === 1 ? claimable[0] : null);
  const remaining = job ? job.adjustedCents - job.invoicedCents : 0;

  const previewCents = claimPreviewCents(job, mode, items, dollars, customPct, remaining);

  const overRemaining = (mode === "fixed" || mode === "items") && previewCents != null && previewCents > remaining;

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
      const pct = mode === "custom" ? Number(customPct) : mode === "fixed" || mode === "items" ? null : Number(mode);
      const result = await requestClaimAction({
        workOrderId: job.workOrderId,
        mode: mode === "fixed" || mode === "items" ? "fixed" : "percent",
        value: mode === "items" ? (previewCents ?? 0) / 100 : mode === "fixed" ? Number(dollars) : pct!,
        lines: mode === "items"
          ? items.map((r) => ({ label: r.label.trim(), cents: Math.round(Number(r.dollars) * 100) }))
          : undefined,
        invoiceDate: invDate || undefined,
      });
      if (result.ok) {
        // Straight to the invoice they just sent — concrete proof it landed.
        // (Tom, 27 Aug: a success message + a list that refreshes late read
        // as "nothing happened"; the invoice page can't be missed.)
        router.push(`/portal/money/${result.id}`);
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
            <button type="button" onClick={() => setMode("items")}
              className={`btn ${mode === "items" ? "cy" : "gh"}`} data-testid="claim-items">
              Line items
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

          {mode === "items" && (
            <div style={{ marginTop: 8 }} data-testid="claim-lines">
              {items.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input type="text" placeholder="What for — the line as it reads on your invoice"
                    value={r.label} maxLength={200}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    style={{ flex: 1, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13 }} />
                  <input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="$"
                    value={r.dollars}
                    onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, dollars: e.target.value } : x)))}
                    style={{ width: 100, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13 }} />
                  {items.length > 1 && (
                    <button type="button" className="btn gh" aria-label="Remove line"
                      onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              ))}
              {items.length < 12 && (
                <button type="button" className="btn gh" style={{ width: "100%" }}
                  onClick={() => setItems((xs) => [...xs, { label: "", dollars: "" }])} data-testid="claim-add-line">
                  + Add a line
                </button>
              )}
            </div>
          )}

          <label className="hint" style={{ display: "block", padding: 0, margin: "10px 0 0" }}>
            Invoice date (yours — defaults to today)
            <input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)}
              data-testid="claim-date"
              style={{ display: "block", width: "100%", marginTop: 4, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13 }} />
          </label>

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
