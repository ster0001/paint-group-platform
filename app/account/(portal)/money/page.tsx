import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalContext, getPortalMoney, melbourneTodayYmd } from "@/lib/portal/data";
import { buildMoneyView, fmtDay, moneyFmt } from "@/lib/portal/money";

export const dynamic = "force-dynamic";

/**
 * 3a-3 · Money: every invoice and receipt across the account's jobs,
 * read-only over the invoicing phase's rows — amounts always AUD inc GST
 * with the GST itemised, honest empty states, print-friendly. Job status
 * and payment status stay separate.
 */
export default async function MoneyPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/account/login");

  const { estimates, invoices, payments } = await getPortalMoney(ctx.accounts.map((a) => a.id));
  const jobs = buildMoneyView(estimates, invoices, payments, melbourneTodayYmd());
  const phone = ctx.companyPhone;

  return (
    <div>
      <h1>Money</h1>

      {jobs.length === 0 && (
        <div className="card raised">
          <p className="sub">
            Nothing to pay, and nothing owing. When there&rsquo;s an invoice or a receipt for one
            of your projects, it will appear right here — with a PDF you can keep.
          </p>
        </div>
      )}

      {jobs.map((job) => (
        <section key={job.estimateId} style={{ marginBottom: 26 }}>
          <div className="card raised">
            <div className="row">
              <div>
                <div className="sub">{job.title}</div>
                {job.projectTotalIncCents != null ? (
                  <>
                    <div className="money" style={{ fontSize: 26, marginTop: 4 }}>
                      {moneyFmt(job.projectTotalIncCents)}
                    </div>
                    {job.projectGstCents != null && (
                      <div className="note" style={{ marginTop: 6 }}>
                        Your project total · includes GST of {moneyFmt(job.projectGstCents)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="note" style={{ marginTop: 6 }}>Invoices for this project</div>
                )}
              </div>
              {job.chip && <span className={`chip ${job.chip.cls}`}>{job.chip.label}</span>}
            </div>
          </div>

          <h2>Invoices &amp; receipts</h2>
          <div className="card">
            {job.rows.map((row, i) => (
              <div key={row.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)", padding: i === 0 ? "2px 0 14px" : "14px 0" }}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <div className="note">
                      {row.number ?? "INVOICE"}{row.issuedOn ? ` · ${fmtDay(row.issuedOn)}` : ""}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3 }}>{row.kindLabel}</div>
                    <div className="note" style={{ marginTop: 4 }}>
                      Includes GST of {moneyFmt(row.gstCents)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div className="money" style={{ fontSize: 16 }}>{moneyFmt(row.totalIncCents)}</div>
                    <div style={{ marginTop: 6 }}>
                      <span className={`chip ${row.chip.cls}`}>{row.chip.label}</span>
                    </div>
                  </div>
                </div>
                {row.balanceCents > 0 && row.balanceCents !== row.totalIncCents && (
                  <div className="note" style={{ marginTop: 6 }}>
                    Still owing: {moneyFmt(row.balanceCents)}
                  </div>
                )}
                {row.token && (
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <Link className="btn btn-ghost" style={{ padding: 12, fontSize: 15 }} href={`/i/${row.token}`}>
                      {row.balanceCents > 0 ? "View & pay" : "View invoice & PDF"}
                    </Link>
                  </div>
                )}
                {row.receipts.map((r) => (
                  <div className="row" key={r.paymentId} style={{ marginTop: 10 }}>
                    <div className="note">
                      {r.number}{r.paidOn ? ` · ${fmtDay(r.paidOn)}` : ""} · receipt
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span className="money" style={{ fontSize: 13 }}>{moneyFmt(r.amountCents)}</span>
                      <a
                        href={`/account/receipt/${r.paymentId}`}
                        className="note"
                        style={{ color: "var(--cyan)" }}
                      >
                        Download PDF
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {job.remainderCents != null && (
              <div style={{ borderTop: job.rows.length ? "1px solid var(--line)" : "none", padding: "14px 0 2px" }}>
                <div className="row">
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>Balance on completion</div>
                    <div className="note" style={{ marginTop: 4 }}>
                      Only due once you&rsquo;ve walked through and signed off.
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div className="money" style={{ fontSize: 16 }}>{moneyFmt(job.remainderCents)}</div>
                    <div style={{ marginTop: 6 }}><span className="chip mut">Not due yet</span></div>
                  </div>
                </div>
              </div>
            )}

            {job.rows.length === 0 && job.remainderCents == null && (
              <p className="sub">Nothing here yet for this project.</p>
            )}
          </div>
        </section>
      ))}

      <div className="card">
        <p className="sub">
          A question about an invoice?{" "}
          {phone ? (
            <>Ring us on <b style={{ color: "var(--text)" }}>{phone}</b> — we&rsquo;ll sort it out together.</>
          ) : (
            <>Reply to any of our emails — we&rsquo;ll sort it out together.</>
          )}
        </p>
      </div>
    </div>
  );
}
