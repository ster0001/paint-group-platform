import { moneyFmt } from "@/lib/portal/money";
import type { TradeMoneyView } from "@/lib/portal/tradeMoney";

/**
 * Session 6 · Portfolio Money (§5.6): outstanding / overdue tiles, then the
 * receivables grouped by property with the client's own references on every
 * line — built for the person doing owner statements or claim
 * reconciliation. Every number arrives from the ledger view-model.
 */
export default function TradeMoneyScreen({ view, orgName }: { view: TradeMoneyView; orgName: string }) {
  return (
    <div>
      <div className="greet">{orgName}</div>
      <h1>Money</h1>

      <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
        <div className="tile">
          <div className="num money" data-testid="money-outstanding">{moneyFmt(view.outstandingCents)}</div>
          <div className="lb">Outstanding · {view.outstandingCount} invoice{view.outstandingCount === 1 ? "" : "s"}</div>
        </div>
        <div className="tile">
          <div className="num money" style={{ color: view.overdueCents > 0 ? "var(--clay)" : undefined }} data-testid="money-overdue">
            {moneyFmt(view.overdueCents)}
          </div>
          <div className="lb">Overdue · {view.overdueCount} invoice{view.overdueCount === 1 ? "" : "s"}</div>
        </div>
      </div>

      {view.groups.length === 0 && (
        <div className="card"><p className="sub">Nothing invoiced yet — receivables land here per property.</p></div>
      )}
      {view.groups.map((g) => (
        <div className="card" key={g.propertyId ?? "other"} data-testid={`money-group-${g.propertyId ?? "other"}`}>
          <b style={{ fontSize: 14 }}>{g.address}</b>
          {g.refLine && <div className="refline">{g.refLine}</div>}
          {g.rows.map((r) => (
            <div key={r.invoiceId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--line)", marginTop: 8 }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13, textTransform: "capitalize" }}>{r.kind}</b>
                <div className="refline">
                  {r.number ?? ""}{r.issuedOn ? ` · issued ${r.issuedOn}` : ""}{r.dueOn ? ` · due ${r.dueOn}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                {r.token
                  ? <a className="money" style={{ fontSize: 13 }} href={`/i/${r.token}`}>{moneyFmt(r.totalIncCents)}</a>
                  : <span className="money" style={{ fontSize: 13 }}>{moneyFmt(r.totalIncCents)}</span>}
                <div>
                  <span className={`chip ${r.balanceCents === 0 ? "emerald" : r.overdue ? "clay" : "cyan"} nodot`} style={{ fontSize: 10 }}>
                    {r.balanceCents === 0 ? "Paid" : r.overdue ? "Overdue" : "Awaiting payment"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
        <a className="btn btn-ghost" href="/account/money/statement" data-testid="statement-pdf">Statement (PDF)</a>
        <a className="btn btn-ghost" href="/account/money/export" data-testid="export-csv">Export CSV</a>
      </div>
    </div>
  );
}
