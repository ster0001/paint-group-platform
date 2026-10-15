import Link from "next/link";
import { LANES } from "@/lib/workorder/stages";
import { suggestedDue } from "@/lib/invoicing/jobMoney";
import type { ProfitLine } from "@/lib/invoicing/jobProfit";
import { Pills, Rail } from "./JobPieces";
import { CiButtons, CostButtons, MatButtons, RowActions, type ActionSpec, type MatSpec } from "./ActionsClient";
import { AddCostButton, InvoiceCardActions, MoneyInLinks, OpenChatButton, RedraftFinal, type CardSpec } from "./PanelClient";
import { KIND_NAME, STAGE_NAME, actionSpec, money, plural, shortDate, startText } from "./labels";
import type { PanelData, PanelInvoice } from "./panelData";

/**
 * The job panel (payments-merge brief §4.7, Step 7), built to the mockup's
 * drawer (renderJob / invHTML / costsHTML). Two tabs only (R18): Money in —
 * every invoice with its payments under it — and Money out and profit (R19).
 * The same component is the side panel on /invoicing (?job=) and the
 * whole of /invoicing/job/[id].
 */

const METHOD: Record<string, string> = { bank_transfer: "bank transfer", cash: "cash", stripe_card: "card", other: "other" };
const BAR: Record<string, string> = { contractor: "#8f7ae0", own_painters: "#d9a13a", materials: "var(--pri)", other: "#c0815a", expenses: "var(--seg)", profit: "var(--green)" };
const KEY_LABEL: Record<string, string> = { contractor: "Contractor", own_painters: "Own painters", materials: "Materials", other: "Other trades", expenses: "Expenses", profit: "Profit" };
const CI_TAG: Record<string, React.ReactNode> = {
  submitted: <span className="tag sent">To approve</span>, approved: <span className="tag need">To pay</span>,
  draft: <span className="tag">With contractor</span>, paid: <span className="tag paid">Paid</span>,
};
const MAT_TAG: Record<string, string> = { rec: "To approve", appr: "To pay", paid: "Paid" };
const COST_TAG: Record<string, string> = { recorded: "To approve", approved: "To pay", paid: "Paid" };

function Tag({ i }: { i: PanelInvoice }) {
  if (i.cashNotSent) return <span className="tag cash">Paid in cash, not sent</span>;
  switch (i.state) {
    case "paid": return <span className="tag paid">Paid</span>;
    case "over": return <span className="tag over">{plural(i.overdueDays ?? 0, "day")} overdue</span>;
    case "need": return <span className="tag need">{i.status === "draft" ? "Not sent, deposit not in" : "Sent, deposit not in"}</span>;
    case "sent": return <span className="tag sent">Sent</span>;
    case "void": return <span className="tag">Void</span>;
    default: return <span className="tag">Draft</span>;
  }
}

/** The row's spec, re-aimed at one invoice: Send / ✓ Paid / Already paid act on it. */
function cardSpec(base: ActionSpec, d: PanelData, i: PanelInvoice, today: string, termsDays: number): CardSpec {
  const kindName = KIND_NAME[i.kind];
  const primary: ActionSpec["primary"] = i.status === "draft"
    ? { kind: "send", invoiceId: i.id, kindName, balanceCents: i.balanceCents, suggestedDueOn: i.dueOn ?? suggestedDue(today, d.row.startDate, termsDays), isDeposit: i.isDeposit }
    : { kind: "pay", invoiceId: i.id, balanceCents: i.balanceCents };
  return {
    invoiceId: i.id, estimateId: d.row.estimateId, status: i.status, state: i.state, isDeposit: i.isDeposit, kindIsDeposit: i.kind === "deposit",
    kindIsClaim: i.kind === "deposit" || i.kind === "progress", number: i.number, paidCents: i.paidCents,
    balanceCents: i.balanceCents, dueOn: i.dueOn, chaseHold: i.chaseHold,
    // The card's own invoice is always the one its sheet pays — even a draft the row hides by rule (§6.2),
    // which is not among the row's payable leads (it paid the final instead, 13 Oct).
    spec: { ...base, primary, payable: [
      { invoiceId: i.id, balanceCents: i.balanceCents, draft: i.status === "draft", label: `${kindName} invoice, ${money(i.balanceCents)} owing${i.status === "draft" ? " (not sent)" : ""}` },
      ...base.payable.filter((t) => t.invoiceId !== i.id),
    ], depositDraft: i.kind === "deposit" && i.status === "draft" ? { invoiceId: i.id, totalCents: i.totalCents } : base.depositDraft },
  };
}

function InvoiceCard({ d, i, base, today, termsDays }: { d: PanelData; i: PanelInvoice; base: ActionSpec; today: string; termsDays: number }) {
  const meta = i.state === "void" ? `Void${i.voidedReason ? ` — ${i.voidedReason}` : ""}.`
    : i.status === "draft" ? `Not sent yet.${i.paidCents > 0 ? ` ${money(i.balanceCents)} still to pay.` : ""}`
    : i.balanceCents > 0 ? `${i.dueOn ? `Due ${shortDate(i.dueOn)}. ` : ""}${i.views ? `Opened ${plural(i.views, "time")}.` : "Not opened yet."}${i.paidCents > 0 ? ` ${money(i.balanceCents)} still to pay.` : ""}`
    : "";
  return (
    <div className={`inv${i.state === "void" ? " gone" : ""}`} data-invoice={i.id} data-kind={i.kind}>
      <div className="h">
        <div>
          <div className="k">{KIND_NAME[i.kind]} invoice{i.isDeposit && i.pctOfContract !== null ? ` (${i.pctOfContract}%)` : ""}</div>
          <div className="no">{i.number ?? "Number given when sent"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {i.balanceCents > 0 && i.state !== "void" ? <span className={`owe ${i.state}`}>{money(i.balanceCents)}</span> : <span className="paidamt">{money(i.totalCents)}</span>}
          <div style={{ marginTop: 6 }}><Tag i={i} /></div>
        </div>
      </div>
      {meta ? <div className="meta">{meta}</div> : null}
      {i.staleFinal ? <div className="cashnote" data-testid="stale-final">This draft was worked out before an earlier invoice on the job was issued, so it charges too much. <RedraftFinal estimateId={d.row.estimateId} /></div> : null}
      {i.cashNotSent ? <div className="cashnote">Paid in cash, so this invoice was not sent to the customer. It stays here as our record of the sale.</div> : null}
      {i.payments.map((p) => (
        <div className="pay" key={p.id} style={p.status === "succeeded" ? undefined : { color: "var(--mute)", textDecoration: "line-through" }}>
          <span><span className="tick">{p.status === "succeeded" ? "✓" : "↺"}</span>{p.status === "succeeded" ? "Paid" : p.status === "reversed" ? "Undone" : p.status} by {METHOD[p.method] ?? p.method}{p.paidOn ? `, ${shortDate(p.paidOn)}` : ""}</span>
          <span className="mono">{money(p.amountCents)}</span>
        </div>
      ))}
      <InvoiceCardActions c={cardSpec(base, d, i, today, termsDays)} today={today} />
    </div>
  );
}

function ProfitSum({ line }: { line: ProfitLine }) {
  return <div title={line.sources.map((s) => `${s.label}: ${money(s.cents)}`).join("\n")}><span>{line.label}</span><span className="mono">− {money(line.cents)}</span></div>;
}

/**
 * The cost rows behind the profit lines (acceptance: "every line traces to a
 * cost row") — own painters, other trades and costs, expenses, and materials
 * not already listed as a supplier invoice. Ex GST, as the lines add them.
 */
function CostRows({ d }: { d: PanelData }) {
  const listed = new Set(d.supplierInvoices.map((m) => m.id));
  const rows = d.profit.lines.filter((l) => l.key !== "contractor")
    .flatMap((l) => l.sources.filter((s) => !(l.key === "materials" && listed.has(s.id))).map((s) => ({ ...s, line: l.label, payable: l.key !== "own_painters" })));
  if (!rows.length) return null;
  return (
    <div className="cost" data-testid="pm-costs">
      <div className="h"><span>Costs recorded on this job, excluding GST</span></div>
      {rows.map((r) => (
        <div className="li" key={r.id} data-testid={`job-cost-item-${r.id}`}>
          <span>{r.label}<small>{r.line}</small></span>
          <span className="r">{r.jobCostStatus ? <span className={`tag ${r.jobCostStatus === "paid" ? "paid" : ""}`}>{COST_TAG[r.jobCostStatus] ?? r.jobCostStatus}</span> : null}
            {/* Tom, 15 Oct 2026: a booked day counts from the day it is booked; the row says it is booked, not yet recorded. */}
            {r.booked ? <span className="tag" data-testid="job-cost-booked">Booked</span> : null}<span className="mono">{money(r.cents)}</span>
            {/* Employee labour is paid through payroll — nothing to approve or mark paid here (Tom, 9 Oct). */}
            {r.payable && r.jobCostStatus ? <CostButtons id={r.id} status={r.jobCostStatus} label={`${r.label} ${money(r.cents)}`} /> : null}</span>
        </div>
      ))}
    </div>
  );
}

export function JobPanel({ d, tab, tabHref, closeHref, closeLabel, today, termsDays, startAddCost = false }: {
  d: PanelData; tab: "in" | "out"; tabHref: (t: "in" | "out") => string; closeHref: string; closeLabel: string;
  today: string; termsDays: number; startAddCost?: boolean;
}) {
  const r = d.row;
  const base = actionSpec(r, `/invoicing/job/${r.estimateId}`);
  const p = d.profit;
  const still = r.balanceCents;
  return (
    <>
      <div className="dh">
        <div className="x">
          <Link className="back" href={closeHref} data-testid="money-back">‹ {closeLabel}</Link>
          {d.woId ? <Link className="b sm" href={`/pc/wo/${d.woId}`}>Work order {d.woRef}</Link> : null}
        </div>
        <h2>{r.address}</h2>
        <div className="cust">{r.customer || "Customer on the work order"}{r.contractor ? ` · ${r.contractor}` : ""}{r.variationsCents ? ` · includes ${money(r.variationsCents)} of variations` : ""}</div>
      </div>
      <div className="db">
        {d.loadProblem ? <div className="note">{d.loadProblem}</div> : null}
        <div className="stagebox">
          <div className="trk-h"><b>{STAGE_NAME[r.lane]}{r.lane === "pre_start" || r.lane === "booking_confirmed" ? `, ${startText(r).toLowerCase()}` : ""}</b><span>{r.section === "paid_in_full" ? "Paid in full" : ""}</span></div>
          <Rail row={r} />
          <div className="names">{LANES.map((l) => <span key={l} className={l === r.lane ? "cur" : ""}>{STAGE_NAME[l]}</span>)}</div>
          <Pills row={r} />
        </div>
        <div className="three" data-testid="money-strip">
          <div><small>Job total</small><b>{money(r.contractCents)}</b></div>
          <div><small>Paid</small><b style={{ color: "var(--green-t)" }}>{money(r.paidCents)}</b></div>
          <div><small>Still owing</small><b style={{ color: still > 0 ? "var(--orange-t)" : "var(--green-t)" }}>{money(Math.max(0, still))}</b></div>
        </div>
        <div className="tabs">
          <Link className={tab === "in" ? "on" : undefined} href={tabHref("in")}>Money in</Link>
          <Link className={tab === "out" ? "on" : undefined} href={tabHref("out")}>Money out and profit</Link>
        </div>

        {tab === "in" ? (
          <>
            <div className="big-act"><RowActions spec={base} /></div>
            <MoneyInLinks estimateId={r.estimateId} contractCents={r.contractCents} />
            {d.invoices.length ? d.invoices.map((i) => <InvoiceCard key={i.id} d={d} i={i} base={base} today={today} termsDays={termsDays} />)
              : <div className="note">No invoice has been raised for this job in the platform.</div>}
            <div className="msgs">
              <h3>Messages with {base.first}<OpenChatButton spec={base} /></h3>
              <p>{d.lastMessage ? `You: “${d.lastMessage.split("\n")[0].slice(0, 110)}${d.lastMessage.length > 110 ? "…" : ""}”` : "Opens this customer’s thread in Customer chats."}</p>
            </div>
          </>
        ) : (
          <>
            <div className="gp" data-testid="pm-profit">
              <small>Gross profit {r.lane === "closed" ? "from the costs recorded" : "so far, job still open"}</small>
              <div><span className="big">{money(p.grossProfitCents)}</span>{p.marginPct !== null ? <span className="pct">{p.marginPct}%</span> : null}</div>
              <div className="split">{p.bar.map((b) => <i key={b.key} style={{ width: `${b.pct}%`, background: BAR[b.key] }} />)}</div>
              <div className="key">{p.bar.map((b) => <span key={b.key}><i style={{ background: BAR[b.key] }} />{KEY_LABEL[b.key]}</span>)}</div>
            </div>
            {p.noMaterialsWarning ? <div className="note">No materials are recorded against this job yet, so this profit is too high until the supplier invoices are matched.</div> : null}
            {d.labourNote ? <div className="note" data-testid="pm-labour-note">{d.labourNote}</div> : null}
            <div className="sum">
              <div><span>Job value, excluding GST</span><span className="mono">{money(p.valueExCents)}</span></div>
              {p.lines.filter((l) => l.cents || l.key === "materials").map((l) => <ProfitSum key={l.key} line={l} />)}
              <div><span>Total costs</span><span className="mono">− {money(p.totalCostsCents)}</span></div>
              <div className="t"><span>Gross profit</span><span className="mono">{money(p.grossProfitCents)}{p.marginPct !== null ? ` (${p.marginPct}%)` : ""}</span></div>
            </div>
            {d.contractors.length ? (
              <div className="cost">
                <div className="h"><span>Contractor invoices on this job</span></div>
                {d.contractors.map((c) => (
                  <div className="li" key={c.id}>
                    <span>{c.contractor}<small>{c.number ?? "Draft"}{c.claimNote ? ` · ${c.claimNote}` : ""}</small></span>
                    <span className="r">{CI_TAG[c.status]}<span className="mono">{money(c.totalIncCents)}</span>
                      <CiButtons id={c.id} status={c.status} rcti={c.rcti}
                        approveLine={`Approved ${c.number ?? "the invoice"}, ${money(c.totalIncCents)} to ${c.contractor}.`}
                        payLine={`Marked ${c.number ?? "the invoice"} paid, ${money(c.totalIncCents)} to ${c.contractor}. The remittance goes when Undo closes.`}
                        payLabel="✓ Paid" /></span>
                  </div>
                ))}
              </div>
            ) : null}
            {d.supplierInvoices.length ? (
              <div className="cost">
                <div className="h"><span>Supplier invoices on this job</span></div>
                {d.supplierInvoices.map((m) => {
                  const ms: MatSpec = { kind: m.kind, id: m.id, state: m.state, supplier: m.supplier, invoiceNo: m.invoiceNo, invoiceDate: m.invoiceDate ? shortDate(m.invoiceDate) : null, reference: m.reference, jobAddress: r.address, amountLabel: money(m.amountCents), unread: false, hasDoc: !!m.docPath };
                  return (
                    <div className="li" key={m.key}>
                      <span>{m.supplier}<small>{m.invoiceNo ?? ""}</small></span>
                      <span className="r"><span className={`tag ${m.state === "paid" ? "paid" : ""}`}>{MAT_TAG[m.state] ?? ""}</span><span className="mono">{money(m.amountCents)}</span><MatButtons row={{ ...ms, state: m.state === "rec" ? "rec" : "paid" }} /></span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <CostRows d={d} />
            {d.woId ? <div style={{ marginTop: 12 }}><AddCostButton estimateId={r.estimateId} woId={d.woId} startOpen={startAddCost} /></div> : null}
            <p className="fine">Figures are the costs recorded in the platform today. Job value including GST is {money(r.contractCents)}.</p>
          </>
        )}
      </div>
    </>
  );
}
