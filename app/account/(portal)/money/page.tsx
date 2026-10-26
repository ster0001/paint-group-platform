import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalMoney, melbourneTodayYmd } from "@/lib/portal/data";
import { buildMoneyView, fmtDay, moneyFmt } from "@/lib/portal/money";

export const dynamic = "force-dynamic";

/**
 * 3a-3 · Payments: every invoice and receipt across the account's jobs,
 * read-only over the invoicing phase's rows — amounts always AUD inc GST
 * with the GST itemised, honest empty states, print-friendly. Job status
 * and payment status stay separate.
 *
 * Portal UX brief (25 Oct 2026): the page is "Payments" (F1); every project
 * card carries Total / Paid / Remaining and a chip that answers "do I owe
 * anything?" (F2); an invoice is ONE row with Invoice PDF + Receipt PDF (F3);
 * an unpaid one carries Pay now into the invoice page's own card payment (F4).
 */
export default async function MoneyPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  // Trade portal v2 session 6: trade accounts get the §5.6 portfolio money
  // view — receivables per property, references on every line, statement +
  // CSV. Residential keeps the 3a-3 page below.
  if (ctx.accounts.some((a) => a.account_type === "trade")) {
    const { getTradeMoney } = await import("@/lib/portal/tradeData");
    const view = await getTradeMoney(ctx, "trade");
    if (view) {
      const { default: TradeMoneyScreen } = await import("./TradeMoneyScreen");
      const orgName = ctx.accounts.find((a) => a.account_type === "trade")?.name?.trim() || "Your organisation";
      return <TradeMoneyScreen view={view} orgName={orgName} />;
    }
  }

  const { estimates, invoices, payments } = await getPortalMoney(ctx.accounts.map((a) => a.id));
  const today = melbourneTodayYmd();
  const jobs = buildMoneyView(estimates, invoices, payments, today, new Date());
  const phone = ctx.companyPhone;

  // 3a-7: the trade header — this month's total across every property, with
  // the statement a trust account can file. ⚑5: terms are display-only.
  const trade = ctx.accounts.some((a) => a.account_type === "trade");
  const month = today.slice(0, 7);
  const monthCents = trade
    ? invoices
        .filter((i) => ["issued", "sent", "viewed", "partially_paid", "paid"].includes(i.status) && (i.issued_on ?? "").startsWith(month))
        .reduce((s, i) => s + i.total_inc_cents, 0)
    : 0;

  return (
    <div>
      <h1>Payments</h1>

      {trade && (
        <div className="card raised">
          <div className="row">
            <div>
              <div className="sub">Invoiced this month</div>
              <div className="money" style={{ fontSize: 26, marginTop: 4 }}>{moneyFmt(monthCents)}</div>
              <div className="note" style={{ marginTop: 6 }}>Inc GST · 14-day terms ⚑</div>
            </div>
            <Link className="btn btn-ghost sm" href={`/account/statement/${month}`}>
              Monthly statement (PDF)
            </Link>
          </div>
        </div>
      )}

      {jobs.length === 0 && (
        <div className="card raised">
          <p className="sub">
            Nothing to pay, and nothing owing. When there&rsquo;s an invoice or a receipt for one
            of your projects, it will appear right here — with a PDF you can keep.
          </p>
        </div>
      )}

      {jobs.map((job) => (
        <section key={job.estimateId} className="card" style={{ marginBottom: 14 }} data-testid="money-project">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <div className="sub">{job.title}</div>
              <div className="money" style={{ fontSize: 24, marginTop: 2 }}>{moneyFmt(job.totalIncCents)}</div>
              <div className="note" style={{ marginTop: 4 }}>
                {job.projectGstCents != null
                  ? <>Project total · includes GST of {moneyFmt(job.projectGstCents)}</>
                  : <>Invoiced so far, inc GST</>}
              </div>
            </div>
            {job.chip && <span className={`chip ${job.chip.cls}`} data-testid="money-project-chip">{job.chip.label}</span>}
          </div>

          {/* F2: the same three numbers on every project. */}
          <div className="sum" data-testid="money-sum">
            <div><small>Total</small><span className="money">{moneyFmt(job.totalIncCents)}</span></div>
            <div><small>Paid</small><span className="money">{moneyFmt(job.paidCents)}</span></div>
            <div><small>Remaining</small><span className="money">{job.remainingCents > 0 ? moneyFmt(job.remainingCents) : "Nothing owing"}</span></div>
          </div>

          {(job.rows.length > 0 || job.remainderCents != null) && <div className="hr" />}

          {job.rows.map((row) => (
            <div key={row.id} className="inv" data-testid="invoice-row">
              {/* F3: one row — number · kind · date in mono, the amount, the state, two small PDF buttons. */}
              <div className="meta-mono">
                {row.number ?? "Invoice"} · {row.kindLabel}{row.issuedOn ? ` · ${fmtDay(row.issuedOn)}` : ""}
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <span className="money amt">{moneyFmt(row.totalIncCents)}</span>
                <span className={`chip ${row.chip.cls}`}>{row.chip.label}</span>
              </div>
              <div className="note" style={{ marginTop: 4 }}>
                Includes GST of {moneyFmt(row.gstCents)}
                {row.balanceCents > 0 && row.balanceCents !== row.totalIncCents ? <> · still owing {moneyFmt(row.balanceCents)}</> : null}
              </div>
              {row.balanceCents > 0 && (
                <div style={{ marginTop: 10 }}>
                  {row.token ? (
                    // F4: the invoice page carries the card payment — Pay now lands on it.
                    <Link className="btn btn-cyan" href={`/i/${row.token}?portal=1`} data-testid="pay-now">
                      Pay now{row.dueOn ? ` · due ${fmtDay(row.dueOn)}` : ""}
                    </Link>
                  ) : (
                    <p className="sub">
                      {row.dueOn ? `Due ${fmtDay(row.dueOn)} · ` : ""}
                      {phone ? <>Ring us on <b style={{ color: "var(--ink)" }}>{phone}</b> to pay.</> : <>Reply to our email to pay.</>}
                    </p>
                  )}
                </div>
              )}
              <div className="acts">
                {row.token && (
                  <a className="btn btn-ghost sm" href={`/account/invoice/${row.id}`} data-testid="invoice-pdf">Invoice PDF</a>
                )}
                {row.receipts.map((r) => (
                  <a key={r.paymentId} className="btn btn-ghost sm" href={`/account/receipt/${r.paymentId}`} data-testid="receipt-pdf">
                    Receipt PDF{row.receipts.length > 1 ? ` · ${r.number}` : ""}
                  </a>
                ))}
              </div>
            </div>
          ))}

          {job.remainderCents != null && (
            <div className="inv">
              <div className="meta-mono">Not yet invoiced</div>
              <div className="row" style={{ marginTop: 4 }}>
                <span className="money amt">{moneyFmt(job.remainderCents)}</span>
                <span className="chip mut">Not due yet</span>
              </div>
              <div className="note" style={{ marginTop: 4 }}>
                Balance on completion — only due once you&rsquo;ve walked through and signed off.
              </div>
            </div>
          )}

          {job.rows.length === 0 && job.remainderCents == null && (
            <p className="sub" style={{ marginTop: 10 }}>Nothing here yet for this project.</p>
          )}
        </section>
      ))}

      <div className="card">
        <p className="sub">
          A question about a payment?{" "}
          {phone ? (
            <>Ring us on <b style={{ color: "var(--ink)" }}>{phone}</b> — we&rsquo;ll sort it out together.</>
          ) : (
            <>Reply to any of our emails — we&rsquo;ll sort it out together.</>
          )}
        </p>
      </div>
    </div>
  );
}
