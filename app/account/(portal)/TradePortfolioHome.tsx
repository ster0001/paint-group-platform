import Link from "next/link";
import { moneyFmt } from "@/lib/portal/money";
import type { PortalContext } from "@/lib/portal/data";
import { getTradePortfolio } from "@/lib/portal/tradeData";
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

      {portfolio.attention.length > 0 && (
        <div className="card" style={{ marginTop: 14 }} data-testid="needs-you">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Needs you</h2>
            <span className="chip mut nodot">{portfolio.attention.length}</span>
          </div>
          {portfolio.attention.map((a) => (
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
