"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { COST_DOCS_BUCKET } from "@/lib/costs/store";
import { checkUpload } from "@/lib/uploads/validate";
import { requestPreapprovalAction, submitExpenseAction } from "./expenseActions";

/**
 * Contractor expenses (Tom, 25 Aug — cost-capture brief §6, camera flow to
 * follow): receipt REQUIRED (no photo, no claim), category from Settings,
 * ask-first over the threshold. Approved claims are repaid on the next
 * invoice as clearly-labelled reimbursement lines.
 */

const money = (c: number) =>
  "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type ExpenseRow = {
  id: string;
  jobTitle: string;
  category: string;
  amountCents: number;
  status: "submitted" | "approved" | "rejected" | "paid";
  overThreshold: boolean;
  note: string;
  createdAt: string;
};

export type ExpenseJob = { workOrderId: string; title: string };
export type Preapproval = {
  id: string; jobTitle: string; description: string;
  estCents: number; capCents: number | null; status: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  materials_topup: "Materials top-up",
  sundries: "Sundries",
  parking: "Parking",
  tip_fees: "Tip fees",
  other: "Other",
};

const STATUS_CHIP: Record<string, string> = {
  submitted: "amber", approved: "cy", rejected: "clay", paid: "ok",
};

export default function Expenses({ jobs, expenses, preapprovals, categories, thresholdCents }: {
  jobs: ExpenseJob[];
  expenses: ExpenseRow[];
  preapprovals: Preapproval[];
  categories: string[];
  thresholdCents: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "claim" | "ask">(null);

  // Claim form
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [woId, setWoId] = useState(jobs.length === 1 ? jobs[0].workOrderId : "");
  const [category, setCategory] = useState(categories[0] ?? "other");
  const [dollars, setDollars] = useState("");
  const [gstDollars, setGstDollars] = useState("");
  const [note, setNote] = useState("");
  // Ask-first form
  const [askDesc, setAskDesc] = useState("");
  const [askDollars, setAskDollars] = useState("");
  const [askWo, setAskWo] = useState(jobs.length === 1 ? jobs[0].workOrderId : "");

  const amountCents = Math.round(Number(dollars) * 100) || 0;
  const overThreshold = amountCents > thresholdCents;
  const approvedPre = preapprovals.find(
    (p) => p.status === "approved" && (p.capCents ?? 0) >= amountCents,
  );

  function onPickFile() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) { setFileName(null); return; }
    const problem = checkUpload(file, "document");
    if (problem) { setMessage(problem); setFileName(null); if (fileRef.current) fileRef.current.value = ""; return; }
    setMessage(null);
    setFileName(file.name);
  }

  function submitClaim() {
    const file = fileRef.current?.files?.[0] ?? null;
    if (!file) { setMessage("Attach the receipt — no photo, no claim."); return; }
    if (!woId) { setMessage("Pick the job first."); return; }
    if (!(amountCents > 0)) { setMessage("Enter the amount from the receipt."); return; }
    start(async () => {
      const signRes = await fetch("/api/costs/doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      const signed = (await signRes.json().catch(() => null)) as { path?: string; token?: string; error?: string } | null;
      if (!signRes.ok || !signed?.path || !signed.token) {
        setMessage(signed?.error ?? "Couldn't get the upload ready — try again.");
        return;
      }
      const supabase = createBrowserClient();
      const { error: upErr } = await supabase.storage
        .from(COST_DOCS_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (upErr) { setMessage("The receipt didn't upload — try again."); return; }

      const r = await submitExpenseAction({
        workOrderId: woId,
        category,
        amountCents,
        gstCents: Math.round(Number(gstDollars || "0") * 100),
        receiptPath: signed.path,
        note: note.trim(),
        preapprovalId: approvedPre?.id,
      });
      setMessage(r.message ?? null);
      if (r.ok) {
        setOpen(null);
        setDollars(""); setGstDollars(""); setNote(""); setFileName(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  function submitAsk() {
    if (!askWo) { setMessage("Pick the job first."); return; }
    const cents = Math.round(Number(askDollars) * 100) || 0;
    if (!(cents > 0)) { setMessage("Roughly how much will it cost?"); return; }
    if (!askDesc.trim()) { setMessage("Say what you need to buy."); return; }
    start(async () => {
      const r = await requestPreapprovalAction({
        workOrderId: askWo, description: askDesc.trim(), estCents: cents,
      });
      setMessage(r.message ?? null);
      if (r.ok) { setOpen(null); setAskDesc(""); setAskDollars(""); router.refresh(); }
    });
  }

  const input = (extra: Record<string, unknown> = {}) => ({
    style: { width: "100%", marginTop: 6, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13 } as const,
    ...extra,
  });

  return (
    <div className="card" data-testid="expenses">
      <div className="tick-head"><b>Expenses</b></div>
      <p className="hint" style={{ padding: 0 }}>
        Receipt photo required — no photo, no claim. Approved expenses are
        repaid on your next invoice, listed separately at cost.
      </p>

      {/* Ask-first (⚑A5 threshold from Settings) */}
      <div style={{ border: "1px solid rgba(224,168,60,.4)", borderRadius: 12, padding: "10px 12px", marginTop: 10 }}>
        <b style={{ fontSize: 13.5 }}>Buying something over {money(thresholdCents)}?</b>
        <p className="hint" style={{ padding: 0, margin: "4px 0 8px" }}>
          Ask first — one tap, and the office gets it straight away. The approval
          shows here with the agreed amount.
        </p>
        {preapprovals.filter((p) => p.status !== "declined").map((p) => (
          <p key={p.id} className="hint" style={{ padding: 0, margin: "0 0 4px" }} data-testid={`preapproval-${p.id}`}>
            {p.description} · {p.jobTitle} —{" "}
            {p.status === "approved"
              ? <b>approved up to {money(p.capCents ?? p.estCents)}</b>
              : "waiting on the office"}
          </p>
        ))}
        {open === "ask" ? (
          <div>
            {jobs.length > 1 && (
              <select value={askWo} onChange={(e) => setAskWo(e.target.value)} {...input()} data-testid="ask-job">
                <option value="" disabled>— which job? —</option>
                {jobs.map((j) => <option key={j.workOrderId} value={j.workOrderId}>{j.title}</option>)}
              </select>
            )}
            <input type="text" placeholder="What do you need to buy?" value={askDesc}
              onChange={(e) => setAskDesc(e.target.value)} maxLength={300} {...input()} data-testid="ask-desc" />
            <input type="number" inputMode="decimal" min="1" step="0.01" placeholder="Rough cost ($)"
              value={askDollars} onChange={(e) => setAskDollars(e.target.value)} {...input()} data-testid="ask-dollars" />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button type="button" className="btn cy" disabled={pending} onClick={submitAsk} data-testid="ask-send">
                {pending ? "Sending…" : "Ask the office"}
              </button>
              <button type="button" className="btn gh" onClick={() => setOpen(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn gh" onClick={() => { setOpen("ask"); setMessage(null); }} data-testid="ask-open">
            Ask before buying
          </button>
        )}
      </div>

      {message && <p className="hint" role="status" data-testid="expense-message" style={{ padding: 0, marginTop: 8 }}>{message}</p>}

      {/* The claims */}
      {expenses.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {expenses.map((e) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--line)" }}
              data-testid={`expense-${e.id}`}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {CATEGORY_LABEL[e.category] ?? e.category}{e.note ? ` — ${e.note}` : ""}
                </div>
                <div className="hint" style={{ padding: 0, fontSize: 11 }}>
                  {e.jobTitle} · receipt ✓{e.overThreshold ? " · over the threshold without pre-approval" : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <span className={`chip ${STATUS_CHIP[e.status] ?? ""}`}>{e.status}</span>
                <b style={{ fontFamily: "var(--mono, monospace)", fontSize: 13 }}>{money(e.amountCents)}</b>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The claim form */}
      {open === "claim" ? (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          {/* The native file input was invisible on the dark theme (the
              portal.css named-input-types trap) — a visible button drives a
              hidden input instead. capture-friendly: phones offer the camera. */}
          <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            onChange={onPickFile} data-testid="expense-file" style={{ display: "none" }} />
          <button type="button" className="btn gh" style={{ width: "100%" }}
            onClick={() => fileRef.current?.click()} data-testid="expense-attach">
            {fileName ? `Receipt attached: ${fileName} ✓ — tap to change` : "📎 Attach the receipt — photo or PDF"}
          </button>
          {jobs.length > 1 && (
            <select value={woId} onChange={(e) => setWoId(e.target.value)} {...input()} data-testid="expense-job">
              <option value="" disabled>— which job? —</option>
              {jobs.map((j) => <option key={j.workOrderId} value={j.workOrderId}>{j.title}</option>)}
            </select>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {categories.map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className={`btn ${category === c ? "cy" : "gh"}`} data-testid={`expense-cat-${c}`}>
                {CATEGORY_LABEL[c] ?? c}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="Amount ($, from the receipt)"
              value={dollars} onChange={(e) => setDollars(e.target.value)} {...input()} data-testid="expense-dollars" />
            <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="GST shown ($)"
              value={gstDollars} onChange={(e) => setGstDollars(e.target.value)} {...input({ style: { width: 130, marginTop: 6, background: "var(--ink)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13 } })} />
          </div>
          <input type="text" placeholder="Note (optional)" value={note} maxLength={300}
            onChange={(e) => setNote(e.target.value)} {...input()} />
          {overThreshold && !approvedPre && (
            <p className="hint" style={{ padding: 0, marginTop: 6, color: "var(--amber, #E0A83C)" }}>
              Over {money(thresholdCents)} without a pre-approval — you can still
              send it, but it&rsquo;s flagged to the office.
            </p>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" className="btn cy" disabled={pending} onClick={submitClaim} data-testid="expense-send">
              {pending ? "Sending…" : `Claim${amountCents > 0 ? ` ${money(amountCents)}` : ""}`}
            </button>
            <button type="button" className="btn gh" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn cy" style={{ width: "100%", marginTop: 10 }}
          onClick={() => { setOpen("claim"); setMessage(null); }} data-testid="expense-open">
          ＋ Claim an expense
        </button>
      )}
    </div>
  );
}
