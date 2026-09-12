import Link from "next/link";
import { moneyFmt } from "@/lib/portal/money";
import type { PortalContext } from "@/lib/portal/data";
import { getTradePortfolio } from "@/lib/portal/tradeData";
import { loadWaitingOnUs } from "@/lib/portal/waiting";
import { createServiceClient } from "@/lib/supabase/service";
import PortfolioList from "./PortfolioList";

/**
 * Trade portal v2 · Session 3 — the Portfolio (brief §5.1), replacing the
 * 3a-7 trade Home. The property is the spine: pulse tiles, the Needs-you
 * queue (one primary action per card), then one card per property with its
 * swatch strip and live progress. All derivation in lib/portal/tradeData +
 * tradePortfolio — this file only renders.
 */
export default async function TradePortfolioHome({ ctx }: { ctx: PortalContext }) {
  const portfolio = await getTradePortfolio(ctx, "trade");
  if (!portfolio) return <div className="card"><p className="sub">The portfolio is unavailable right now — try again shortly.</p></div>;

  const orgName = ctx.accounts.find((a) => a.account_type === "trade")?.name?.trim() || "Your organisation";
  /**
   * C15 (A1): "Waiting on us" first — quotes with the estimator and quotes
   * fixed and ready to accept, derived from `confirmation_requests` through
   * the CRM's own evaluator (one evaluator, no second list). A quote that is
   * "ready to accept" here is dropped from Needs-you below so it is said once.
   */
  const svc = createServiceClient();
  const addressOf = (pid: string | null, title: string | null) => {
    const p = pid ? ctx.properties.find((x) => x.id === pid) : null;
    return [p?.address, p?.suburb].filter(Boolean).join(", ") || title?.trim() || "Your property";
  };
  const waiting = svc ? await loadWaitingOnUs(svc, ctx.accounts.map((a) => a.id), addressOf, ctx.coordinatorName || null) : [];
  const readyIds = new Set(waiting.filter((w) => w.stage === "ready").map((w) => w.estimateId));
  const attention = portfolio.attention.filter((a) => !readyIds.has(a.key.replace(/^estimate:/, "")));
  // C15: the measured marker on the property list and the rebook links.
  const measured = new Set<string>();
  if (svc && ctx.properties.length) {
    const { data } = await svc.from("properties").select("id, measured_at").in("id", ctx.properties.map((p) => p.id)).not("measured_at", "is", null);
    for (const r of (data ?? []) as Array<{ id: string }>) measured.add(r.id);
  }
  // Formatted straight from now() in the Melbourne zone — never via an
  // offset literal (the boundary test bans +10:00; it's +11 half the year).
  const today = new Date().toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Australia/Melbourne",
  });

  return (
    <div>
      <div className="greet">{orgName}</div>
      <h1>Your properties, at a glance</h1>
      <p className="sub" style={{ marginTop: 6 }}>
        {today}{portfolio.onSiteThisWeek > 0 ? ` · ${portfolio.onSiteThisWeek} job${portfolio.onSiteThisWeek === 1 ? "" : "s"} on site this week` : ""}
      </p>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <Link className="btn btn-cyan" href="/account/quote/new" data-testid="new-quote">+ New quote</Link>
      </div>

      {waiting.length > 0 && (
        <div className="card" style={{ marginTop: 14 }} data-testid="waiting-on-us">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Waiting on us</h2>
            <span className="chip mut nodot">{waiting.length}</span>
          </div>
          {waiting.map((w) => (
            <Link className="job" key={w.key} href={w.cta.href} data-testid={`waiting-${w.stage}`} style={{ display: "block", marginBottom: 8 }}>
              <div className="row" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="addr" style={{ fontWeight: 600 }}>{w.stage === "ready" ? "✓ " : "◷ "}{w.address}</div>
                  <div className="meta">{w.meta}</div>
                </div>
                <span className={`chip ${w.stage === "ready" ? "emerald" : "cyan"} nodot`} style={{ flex: "none", alignSelf: "center" }}>{w.cta.label} ›</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {measured.size > 0 && (
        <div className="card" style={{ marginTop: 14 }} data-testid="measured-properties">
          <h2 style={{ margin: "0 0 6px" }}>Quote again from the file</h2>
          {ctx.properties.filter((p) => measured.has(p.id)).slice(0, 8).map((p) => (
            <Link className="job" key={p.id} href={`/account/quote/new?property=${p.id}`} data-testid="rebook-measured" style={{ display: "block", marginBottom: 8 }}>
              <div className="row" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div className="addr" style={{ fontWeight: 600 }}>⌂ {[p.address, p.suburb].filter(Boolean).join(", ") || "Your property"}</div>
                <span className="chip emerald nodot" style={{ flex: "none" }}>Measured · rebook ›</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <div className="card" style={{ marginTop: 14 }} data-testid="needs-you">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Needs you</h2>
            <span className="chip mut nodot">{attention.length}</span>
          </div>
          {attention.map((a) => (
            <div className="job attn" key={a.key} style={{ marginBottom: 10 }}>
              <div className="row" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="addr" style={{ fontWeight: 600 }}>{a.address}</div>
                  <div className="meta">{a.meta}</div>
                </div>
                {a.amountCents != null && (
                  <span className="money" style={{ fontSize: 14, flex: "none" }}>{moneyFmt(a.amountCents)}</span>
                )}
              </div>
              <div className="btn-row">
                <Link className="btn btn-cyan" style={{ padding: 12, fontSize: 15 }} href={a.cta.href}>{a.cta.label}</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <PortfolioList pulse={portfolio.pulse} cards={portfolio.cards} />

      <h2>Prefer to talk?</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: ctx.companyPhone ? 14 : 0 }}>
          {ctx.companyPhone
            ? <>Statements, approvals, anything at all — ring us on <b style={{ color: "var(--text)" }}>{ctx.companyPhone}</b>.</>
            : <>Statements, approvals, anything at all — reply to any of our emails.</>}
        </p>
        {ctx.companyPhone && (
          <a className="btn btn-ghost" href={`tel:${ctx.companyPhone.replace(/\s+/g, "")}`}>Call us</a>
        )}
      </div>
    </div>
  );
}
