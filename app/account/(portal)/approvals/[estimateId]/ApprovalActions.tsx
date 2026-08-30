"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApprovalStrip } from "@/lib/portal/approvals";
import { approveTradeEstimate, sendExternalApproval } from "../actions";

/**
 * Session 5 · The trade action strip (§5.4). The server re-checks everything;
 * this renders the decisions: approve (with the ⚑2 advisory over-limit
 * warning and the ⚑5 PO prompt), send to the owner/colleague/assessor, or
 * take it to the message thread.
 */
export default function ApprovalActions({ estimateId, strip, pendingExternal }: {
  estimateId: string;
  strip: ApprovalStrip;
  pendingExternal: { approverName: string; sentAt: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [po, setPo] = useState("");
  const [warn, setWarn] = useState<{ limitCents: number; totalCents: number } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "sent" | null>(null);

  const fmt = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

  function approve(anyway: boolean) {
    setMsg(null);
    start(async () => {
      const r = await approveTradeEstimate({ estimateId, poNumber: po, approveAnyway: anyway });
      if (r.ok) { setDone("approved"); setWarn(null); router.refresh(); return; }
      if (r.kind === "over_limit") { setWarn({ limitCents: r.limitCents, totalCents: r.totalCents }); return; }
      setMsg(r.message);
    });
  }

  function send() {
    setMsg(null);
    start(async () => {
      const r = await sendExternalApproval({ estimateId, approverName: name, approverEmail: email });
      if (r.ok) { setDone("sent"); setSendOpen(false); router.refresh(); return; }
      setMsg(r.message);
    });
  }

  if (done === "approved") {
    return (
      <div className="card" data-testid="approval-done">
        <span className="chip emerald nodot">Approved</span>
        <p className="sub" style={{ marginTop: 8 }}>
          All confirmed — the deposit invoice is on its way and the job moves to booking.
        </p>
      </div>
    );
  }

  return (
    <div>
      {pendingExternal && done !== "sent" && (
        <div className="card" data-testid="pending-external">
          <span className="chip cyan nodot">Sent to {pendingExternal.approverName}</span>
          <p className="sub" style={{ marginTop: 8 }}>Awaiting their decision — you&apos;ll see it on the timeline the moment it lands.</p>
        </div>
      )}
      {done === "sent" && (
        <div className="card" data-testid="external-sent">
          <span className="chip cyan nodot">On its way</span>
          <p className="sub" style={{ marginTop: 8 }}>
            {name || "They"} now has a direct link to review and decide. You&apos;ll see when they open it and what they decide.
          </p>
        </div>
      )}

      {strip.showPoPrompt && strip.canApprove && (
        <label style={{ display: "block", margin: "0 0 10px" }}>
          PO number <span className="sub" style={{ fontSize: 12 }}>(optional now — needed before the final invoice)</span>
          <input className="field" value={po} onChange={(e) => setPo(e.target.value)}
            placeholder="e.g. BAC-2026-0712" data-testid="po-input" style={{ marginTop: 6 }} />
        </label>
      )}

      {warn && (
        <div className="card" style={{ borderColor: "var(--amber)" }} data-testid="over-limit-warning">
          <span className="chip amber nodot">Over your approval limit</span>
          <p className="sub" style={{ marginTop: 8 }}>
            This estimate is {fmt(warn.totalCents)} inc GST — above your {fmt(warn.limitCents)} limit.
            You can still approve; your organisation&apos;s admins will see it on the job&apos;s timeline.
          </p>
          <button className="btn btn-cyan" style={{ marginTop: 10 }} disabled={pending}
            onClick={() => approve(true)} data-testid="approve-anyway">
            Approve anyway
          </button>
        </div>
      )}

      {strip.canApprove && !warn && (
        <button className="btn btn-cyan" style={{ marginBottom: 8 }} disabled={pending}
          onClick={() => approve(false)} data-testid="approve">
          {strip.approveLabel}
        </button>
      )}
      {strip.referredToOwner && (
        <div className="card" data-testid="referred-to-owner">
          <p className="sub" style={{ margin: 0 }}>This one goes to the owner to approve — send it on below.</p>
        </div>
      )}

      {!sendOpen ? (
        <button className="btn btn-ghost" style={{ marginBottom: 8 }} onClick={() => setSendOpen(true)} data-testid="send-open">
          {strip.sendLabel}
        </button>
      ) : (
        <div className="card">
          <label>Their name
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} style={{ marginTop: 6, marginBottom: 10 }} data-testid="send-name" />
          </label>
          <label>Their email
            <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 6, marginBottom: 10 }} data-testid="send-email" />
          </label>
          <button className="btn btn-cyan" disabled={pending} onClick={send} data-testid="send-go">
            Send the approval link
          </button>
          <p className="sub" style={{ fontSize: 12, marginTop: 8 }}>
            They get a direct link to approve — no account needed. You&apos;ll see when they&apos;ve opened it and what they decided.
          </p>
        </div>
      )}

      {msg && <p className="note" style={{ color: "var(--amber)" }} role="status">{msg}</p>}
    </div>
  );
}
