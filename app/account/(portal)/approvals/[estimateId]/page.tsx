import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalContext } from "@/lib/portal/data";
import { getApprovalScreen } from "@/lib/portal/approvalData";
import { moneyFmt } from "@/lib/portal/money";
import ApprovalActions from "./ApprovalActions";

export const dynamic = "force-dynamic";

/**
 * Trade portal v2 · Session 5 — the approval screen (§5.4). The estimate
 * document itself renders at /e (the standing one-component rule: the portal
 * lists and decides, /e renders); this screen carries the property
 * references, the colours block, the terms line, and the trade action strip.
 */
export default async function TradeApprovalPage({ params }: { params: Promise<{ estimateId: string }> }) {
  const { estimateId } = await params;
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");
  if (!ctx.accounts.some((a) => a.account_type === "trade")) redirect("/account");

  const screen = await getApprovalScreen(ctx, estimateId);
  if (!screen) notFound();
  const { estimate, strip } = screen;

  return (
    <div>
      <Link href="/account" className="sub" style={{ display: "inline-block", marginBottom: 8 }}>‹ Back</Link>
      <div className="greet">{screen.address ?? "Estimate"}</div>
      <h1>{estimate.title}</h1>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 14px" }}>
        {screen.references.map((r) => (
          <span className="chip mut nodot" key={r.label}>{r.label} · {r.value}</span>
        ))}
      </div>

      {estimate.status !== "sent" ? (
        <div className="card" data-testid="approval-closed">
          <span className={`chip ${estimate.status === "accepted" ? "emerald" : "mut"} nodot`}>
            {estimate.status === "accepted" ? "Approved" : "Not open for a decision"}
          </span>
          <p className="sub" style={{ marginTop: 8 }}>
            {estimate.status === "accepted"
              ? "This estimate has been approved — the job is under way on the property's timeline."
              : "This estimate isn't awaiting a decision."}
          </p>
        </div>
      ) : (
        <>
          <div className="card raised">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <h3 style={{ margin: 0 }}>Total inc GST</h3>
              <span className="money" style={{ fontSize: 17 }} data-testid="approval-total">{moneyFmt(estimate.totalCents)}</span>
            </div>
            <p className="sub" style={{ marginTop: 6 }}>
              Deposit on approval · balance on sign-off, {strip.termsDays}-day terms
            </p>
            {estimate.shareToken && (
              <a className="btn btn-ghost" style={{ marginTop: 10 }}
                href={`/e/${estimate.shareToken}?portal=1`} data-testid="open-document">
                Open the full estimate document
              </a>
            )}
          </div>

          {screen.hasAppliedColours && (
            <div className="card" data-testid="colours-repeat">
              <h3 style={{ marginTop: 0 }}>Colours</h3>
              <p className="sub" style={{ margin: 0 }}>
                We&apos;ll repeat the colour card on file for this property. Change this any time
                before the pre-start check — just say so on the message thread.
              </p>
            </div>
          )}

          {screen.role === "viewer" || screen.role === "finance" ? (
            <div className="card" data-testid="no-approve-role">
              <p className="sub" style={{ margin: 0 }}>
                Your access is view-only here — an approver or admin on your team makes this call.
              </p>
            </div>
          ) : (
            <ApprovalActions estimateId={estimate.id} strip={strip} pendingExternal={screen.pendingExternal} />
          )}

          <Link className="btn btn-ghost" style={{ marginTop: 8, color: "var(--muted)" }}
            href={`/account/messages/${estimate.id}`}>
            Ask a question or request a change
          </Link>
        </>
      )}
    </div>
  );
}
