import Link from "next/link";
import { LANES } from "@/lib/workorder/stages";
import {
  TABLE_FILTERS, laneTone, tableFilter, totalCollectableCents, totalNowCents, totalOverdueCents,
  type JobMoneyRow, type Section, type SlotKey, type TableFilter,
} from "@/lib/invoicing/jobMoney";
import { Actions, JobCard, Lights, Rail, jobHref } from "./JobPieces";
import { KIND_NAME, SLOT_NAME, STAGE_NAME, dueText, money, oweOf, plural, whatText } from "./labels";

/**
 * The Customers block's three views (§4.2, R10): To chase · By job stage ·
 * All jobs. Every list arrives filtered and ordered by lib/invoicing/jobMoney
 * (`matchRows`, `compareRows`); every total is a lib sum.
 */

type Href = (over: Record<string, string | null>) => string;

function Sec({ title, note, rows, cls = "", collapsed = false }: { title: string; note?: string; rows: JobMoneyRow[]; cls?: string; collapsed?: boolean }) {
  if (!rows.length) return null;
  const head = (
    <div className="sec-h"><h2>{title}</h2><span className="tot"><small>{plural(rows.length, "job")}</small>{money(totalNowCents(rows))}</span></div>
  );
  const body = <>{note ? <p className="sec-note">{note}</p> : null}{rows.map((r) => <JobCard key={r.estimateId} row={r} />)}</>;
  return collapsed
    ? <details className="sec"><summary>{head}</summary>{body}</details>
    : <section className={`sec ${cls}`}>{head}{body}</section>;
}

export function ChaseView({ rows, hiddenDrafts, expandOffer, href }: { rows: JobMoneyRow[]; hiddenDrafts: number; expandOffer: boolean; href: Href }) {
  const by = (s: Section) => rows.filter((r) => r.section === s);
  const quiet = by("nothing").length;
  const any = ["overdue", "deposit_not_in", "closed_owing", "waiting", "not_booked"].some((s) => by(s as Section).length);
  return (
    <>
      <Sec title="Overdue" note="Past the due date. Always first on this page." rows={by("overdue")} cls="red" />
      <Sec title="Deposit not in" note="Booked or already started with nothing paid. Jobs already under way first, then soonest start. Starting within a week pulses." rows={by("deposit_not_in")} cls="org" />
      <Sec title="Closed jobs with money still to come" rows={by("closed_owing")} />
      <Sec title="Other invoices waiting to be paid" rows={by("waiting")} />
      <Sec title="Accepted, not booked in yet" note="Nothing to chase until the job has a date. Deposit drafts are ready." rows={by("not_booked")} collapsed={!expandOffer} />
      {!any ? <div className="empty">Nothing to chase here.</div> : null}
      {quiet ? <p className="quiet">{plural(quiet, "job")} {quiet > 1 ? "have" : "has"} nothing to collect right now. <Link href={href({ view: "table" })}>See all jobs</Link></p> : null}
      {hiddenDrafts ? <p className="quiet">{plural(hiddenDrafts, "leftover draft invoice")} not shown here: $0.00 drafts, and deposit drafts on jobs that already have a final invoice.</p> : null}
    </>
  );
}

export function BoardView({ rows }: { rows: JobMoneyRow[] }) {
  return (
    <>
      <div className="legend">
        <span><span className="lt paid">D</span> paid</span><span><span className="lt sent">D</span> sent, waiting</span>
        <span><span className="lt need">D</span> deposit not in</span><span><span className="lt over">F</span> overdue</span>
        <span><span className="lt">F</span> not sent</span><span><span className="lt later">F</span> later</span><span>D deposit · P progress · F final</span>
      </div>
      <div className="board">
        {LANES.map((lane) => {
          const inLane = rows.filter((r) => r.lane === lane);
          const open = inLane.filter((r) => r.section !== "paid_in_full");
          const od = totalOverdueCents(inLane);
          const depositsIn = inLane.filter((r) => r.slots.deposit.state === "paid").length;
          return (
            <section key={lane} className={`lane ${laneTone(open)}`}>
              <div className="lane-h">
                <h3>{STAGE_NAME[lane]}<span>{inLane.length}</span></h3>
                <div className="v">{money(totalCollectableCents(open))}</div>
                {od ? <div className="x">{money(od)} overdue</div> : null}
                <div className="s">{inLane.length ? `Deposits in: ${depositsIn} of ${inLane.length}` : "No jobs"}</div>
              </div>
              {inLane.map((r) => {
                const owe = oweOf(r);
                const what = whatText(r);
                return (
                  <Link key={r.estimateId} className={`mini h-${r.health}`} href={jobHref(r)}>
                    <div className="a">{r.address.split(",")[0]}</div>
                    <div className="c">{r.customer || r.woRef}</div>
                    <div className="l"><Lights row={r} /><span className="o">{owe.amount ? <span className={`owe sm ${owe.state}`}>{owe.amount}</span> : r.section === "paid_in_full" ? <span className="okc">✓</span> : null}</span></div>
                    <div className={`w ${r.health === "need" || r.health === "noinv" ? "need" : r.health === "over" ? "over" : ""}`}>{what}</div>
                  </Link>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}

function Cell({ row, k }: { row: JobMoneyRow; k: SlotKey }) {
  const s = row.slots[k];
  const label = <span className="lbl">{SLOT_NAME[k]}</span>;
  switch (s.state) {
    case "none": return <>{label}<span className="cell none">–</span></>;
    case "paid": return <>{label}<span className="cell paid">✓ Paid</span></>;
    case "later": return <>{label}<span className="cell later">{money(s.amountCents ?? 0)}<small>at sign-off</small></span></>;
    case "uninv": return <>{label}<span className="cell"><span className="owe sm uninv">{money(s.amountCents ?? 0)}</span><small>not invoiced</small></span></>;
    case "noinv": return <>{label}<span className="cell"><span className="owe sm uninv">No invoice</span><small>job is booked</small></span></>;
  }
  const lead = s.lead;
  if (!lead) return <>{label}<span className="cell none">–</span></>;
  const otherKind = KIND_NAME[lead.kind] !== SLOT_NAME[k] ? `, ${KIND_NAME[lead.kind].toLowerCase()} invoice` : "";
  return <>{label}<span className="cell"><span className={`owe sm ${s.state}`}>{money(lead.balanceCents)}</span><small>{dueText(lead)}{otherKind}</small></span></>;
}

function Row({ row }: { row: JobMoneyRow }) {
  const paid = row.section === "paid_in_full";
  return (
    <div className={`tr${row.health === "over" ? " isover" : ""}`} data-estimate={row.estimateId}>
      <div className="td jb"><div className="a"><Link href={jobHref(row)}>{row.address}</Link></div><div className="c">{row.customer || row.woRef}</div></div>
      <div className="td st"><b>{STAGE_NAME[row.lane]}</b><Rail row={row} /></div>
      <div className="td"><Cell row={row} k="deposit" /></div>
      <div className="td"><Cell row={row} k="progress" /></div>
      <div className="td"><Cell row={row} k="final" /></div>
      <div className={`td ow${paid ? " zero" : ""}`}>{paid ? "✓ Paid in full" : money(row.balanceCents)}</div>
      <div className="td ac"><Actions row={row} small /></div>
    </div>
  );
}

const CHIP: Record<TableFilter, string> = { all: "All", over: "Overdue", dep: "Deposit not in", fin: "Final unpaid", paid: "Paid in full" };

export function TableView({ rows, filter, showPaid, href }: { rows: JobMoneyRow[]; filter: TableFilter; showPaid: boolean; href: Href }) {
  const list = rows.filter(tableFilter(filter, showPaid));
  const overdue = list.filter((r) => r.health === "over");
  return (
    <>
      <div className="fchips">
        {TABLE_FILTERS.map((f) => (
          <Link key={f} className={filter === f ? "on" : undefined} href={href({ f: f === "all" ? null : f })}>
            {CHIP[f]}<span>{rows.filter(tableFilter(f, showPaid)).length}</span>
          </Link>
        ))}
      </div>
      <div className="tbl">
        <div className="tr head"><div>Job</div><div>Job stage</div><div>Deposit</div><div>Progress</div><div>Final</div><div style={{ textAlign: "right" }}>Still owing</div><div /></div>
        {overdue.length ? (
          <>
            <div className="tr grp red">Overdue<span>{plural(overdue.length, "job")}, <b>{money(totalOverdueCents(overdue))}</b></span></div>
            {overdue.map((r) => <Row key={r.estimateId} row={r} />)}
          </>
        ) : null}
        {LANES.map((lane) => {
          const inLane = list.filter((r) => r.lane === lane && r.health !== "over");
          if (!inLane.length) return null;
          return (
            <div key={lane} style={{ display: "contents" }}>
              <div className="tr grp">{STAGE_NAME[lane]}<span>{plural(inLane.length, "job")}, <b>{money(totalCollectableCents(inLane))}</b> to collect</span></div>
              {inLane.map((r) => <Row key={r.estimateId} row={r} />)}
            </div>
          );
        })}
        {!list.length ? <div className="empty">No jobs match.</div> : null}
      </div>
    </>
  );
}
