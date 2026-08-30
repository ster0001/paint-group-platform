import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { melbourneTodayYmd } from "@/lib/portal/data";
import { moneyFmt } from "@/lib/portal/money";
import ExternalDecision from "./ExternalDecision";
import "@/app/account/account.css";

export const dynamic = "force-dynamic";

/**
 * Trade portal v2 · Session 5 — the external approver's link (§5.5): the
 * owner / colleague / assessor lands here with no login, sees what they're
 * deciding on (with the property references), opens the full document at
 * /e, and approves with a typed signature — the same acceptance path as
 * every other approval. Unknown token = 404, expired = an honest card.
 */
export default async function ExternalApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{24,}$/.test(token)) notFound();
  const svc = createServiceClient();
  if (!svc) notFound();

  const { data } = await svc.from("external_approvals")
    .select("id, approver_name, viewed_at, decided_at, decision, signer_name, expires_on, estimate_id, property_id, estimates(title, status, total_cents, share_token)")
    .eq("token", token).maybeSingle();
  if (!data) notFound();
  const est = (Array.isArray(data.estimates) ? data.estimates[0] : data.estimates) as
    | { title: string | null; status: string; total_cents: number | null; share_token: string | null } | null;
  if (!est) notFound();

  // View tracking (§5.5): first open stamps viewed_at — the sender sees it.
  if (!data.viewed_at) {
    await svc.from("external_approvals").update({ viewed_at: new Date().toISOString() }).eq("id", data.id).is("viewed_at", null);
  }

  const refs = data.property_id
    ? ((await svc.from("property_references").select("label, value").eq("property_id", data.property_id).order("sort")).data ?? [])
    : [];

  const expired = Boolean(data.expires_on && (data.expires_on as string) < melbourneTodayYmd() && !data.decided_at);
  const decided = data.decided_at ? { decision: data.decision as string, signer: data.signer_name as string | null } : null;
  const alreadyAccepted = est.status === "accepted" && !decided;

  return (
    <div className="acct" style={{ maxWidth: 560, margin: "0 auto", padding: "28px 18px 60px" }}>
      <div className="greet">Paint Group · approval requested</div>
      <h1>{est.title?.trim() || "Painting works"}</h1>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 14px" }}>
        {(refs as Array<{ label: string; value: string }>).map((r) => (
          <span className="chip mut nodot" key={r.label}>{r.label} · {r.value}</span>
        ))}
      </div>

      <div className="card raised">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Total inc GST</h3>
          <span className="money" style={{ fontSize: 17 }}>{moneyFmt(est.total_cents ?? 0)}</span>
        </div>
        {est.share_token && (
          <a className="btn btn-ghost" style={{ marginTop: 10 }} href={`/e/${est.share_token}`} data-testid="external-open-document">
            Read the full estimate first
          </a>
        )}
      </div>

      {decided ? (
        <div className="card" data-testid="external-already-decided">
          <span className={`chip ${decided.decision === "approved" ? "emerald" : "mut"} nodot`}>
            {decided.decision === "approved" ? `Approved${decided.signer ? ` · ${decided.signer}` : ""}` : "Declined"}
          </span>
          <p className="sub" style={{ marginTop: 8 }}>A decision has already been recorded on this link.</p>
        </div>
      ) : expired ? (
        <div className="card" data-testid="external-expired">
          <span className="chip amber nodot">This link has expired</span>
          <p className="sub" style={{ marginTop: 8 }}>The estimate&apos;s validity has passed — ask {`the sender`} for a fresh one.</p>
        </div>
      ) : alreadyAccepted ? (
        <div className="card">
          <span className="chip emerald nodot">Already approved</span>
          <p className="sub" style={{ marginTop: 8 }}>This estimate has been approved by someone else — nothing left to do.</p>
        </div>
      ) : est.status !== "sent" ? (
        <div className="card"><p className="sub" style={{ margin: 0 }}>This estimate isn&apos;t open for a decision.</p></div>
      ) : (
        <ExternalDecision token={token} approverName={(data.approver_name as string) ?? ""} />
      )}
    </div>
  );
}
