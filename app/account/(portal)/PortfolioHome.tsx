import Link from "next/link";
import { buildPortfolio } from "@/lib/portal/portfolio";
import { moneyFmt } from "@/lib/portal/money";
import { getPortalJobs, getPortalMoney, getPortalVariations, melbourneGreeting, melbourneTodayYmd, type PortalContext } from "@/lib/portal/data";

/**
 * 3a-7 · The trade Home (§6 W1, the mockup's commercial persona): every
 * property, every job, one screen — tiles, the attention queue with one
 * primary action each, and the jobs underway. All aggregation over the
 * same customer-safe rows the residential portal reads.
 */
export default async function PortfolioHome({ ctx }: { ctx: PortalContext }) {
  const accountIds = ctx.accounts.map((a) => a.id);
  const [{ estimates, workOrders }, money, variations] = await Promise.all([
    getPortalJobs(accountIds),
    getPortalMoney(accountIds),
    getPortalVariations(accountIds),
  ]);
  const { tiles, attention, underway } = buildPortfolio({
    estimates,
    workOrders,
    invoices: money.invoices,
    payments: money.payments,
    variations,
    todayYmd: melbourneTodayYmd(),
  });

  return (
    <div>
      <div className="greet">{melbourneGreeting()}{ctx.firstName ? `, ${ctx.firstName}` : ""}</div>
      <h1>Your properties, at a glance</h1>

      <div className="tiles">
        <div className="tile"><div className="num cy">{tiles.underway}</div><div className="lb">Jobs underway</div></div>
        <div className="tile"><div className="num am">{tiles.waitingOnYou}</div><div className="lb">Waiting on you</div></div>
        <div className="tile"><div className="num">{tiles.drafts}</div><div className="lb">Draft estimates</div></div>
        <div className="tile"><div className="num em money">{moneyFmt(tiles.invoicedThisMonthCents)}</div><div className="lb">Invoiced this month, inc GST</div></div>
      </div>

      <Link className="btn btn-cyan" href="/account/new-estimate" style={{ margin: "0 0 8px" }}>
        Start a new estimate
      </Link>

      {attention.length > 0 && (
        <>
          <h2>Needs your attention</h2>
          {attention.map((a) => (
            <div className="job attn" key={a.key}>
              <div className="row">
                <div style={{ minWidth: 0 }}>
                  <div className="addr">{a.address}</div>
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
        </>
      )}

      <h2>Jobs underway</h2>
      {underway.length === 0 && (
        <div className="card"><p className="sub">Nothing on site right now — your next job will appear here the day it starts.</p></div>
      )}
      {underway.map((j) => (
        <div className="job" key={j.estimateId}>
          <div className="row">
            <div className="addr">{j.address}</div>
            <span className={`chip ${j.chip.cls}`}>{j.chip.label}</span>
          </div>
          <div className="meta">{j.meta}</div>
          {j.progressPct != null && (
            <div className="pbar"><i style={{ width: `${j.progressPct}%` }} /></div>
          )}
        </div>
      ))}

      <h2>Prefer to talk?</h2>
      <div className="card">
        <p className="sub" style={{ marginBottom: ctx.companyPhone ? 14 : 0 }}>
          {ctx.companyPhone
            ? <>Statements, different terms, anything at all — ring us on <b style={{ color: "var(--text)" }}>{ctx.companyPhone}</b>.</>
            : <>Statements, different terms, anything at all — reply to any of our emails.</>}
        </p>
        {ctx.companyPhone && (
          <a className="btn btn-ghost" href={`tel:${ctx.companyPhone.replace(/\s+/g, "")}`}>Call us</a>
        )}
      </div>
    </div>
  );
}
