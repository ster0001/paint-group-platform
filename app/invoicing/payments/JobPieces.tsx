import Link from "next/link";
import { LANES } from "@/lib/workorder/stages";
import type { JobMoneyRow, SlotKey } from "@/lib/invoicing/jobMoney";
import {
  SLOT_LETTER, SLOT_NAME, STAGE_NAME, actionSpec, money, oweOf, pillOf, plural, railLabel, startText, stillToInvoicePill,
  type PillView,
} from "./labels";
import { AdjustButton, DepositAdjust, RowActions } from "./ActionsClient";

/**
 * The job row (§4.2), the same pieces in every view: rail, pills, amount
 * block, actions. Server components; markup and class names follow
 * design/reference/payments-merged-v3-mockup.html (cardHTML, railHTML,
 * pillHTML, actHTML). The buttons are client components (ActionsClient.tsx)
 * fed an ActionSpec decided here.
 */

const SLOTS: readonly SlotKey[] = ["deposit", "progress", "final"];
/** Gate positions on the rail: deposit at the Pre-start/In-progress seam, progress mid-job, final at the end. */
const GATE_LEFT: Record<SlotKey, string> = { deposit: "42.86%", progress: "57.14%", final: "100%" };

export const jobHref = (r: JobMoneyRow) => `/invoicing/job/${r.estimateId}?from=${encodeURIComponent("/invoicing/payments")}`;

export function Rail({ row }: { row: JobMoneyRow }) {
  const at = LANES.indexOf(row.lane);
  return (
    <div className="rail" role="img" aria-label={railLabel(row)}>
      <div className="segs">{LANES.map((l, k) => <i key={l} className={k < at ? "done" : k === at ? "cur" : ""} />)}</div>
      {SLOTS.filter((k) => k !== "progress" || row.slots.progress.state !== "none").map((k) => (
        <i key={k} className={`gate ${row.slots[k].state}`} style={{ left: GATE_LEFT[k] }} />
      ))}
    </div>
  );
}

function Pill({ p, estimateId }: { p: PillView; estimateId: string }) {
  return (
    <span className={`pill ${p.state}`}>
      <i />
      <span>{p.before}{p.amount ? <> <b>{p.amount}</b></> : null}{p.after ? ` ${p.after}` : ""}</span>
      {p.editable ? <> <AdjustButton estimateId={estimateId} /></> : null}
    </span>
  );
}

export function Pills({ row }: { row: JobMoneyRow }) {
  const pills = SLOTS.map((k) => pillOf(row, k)).filter((p): p is PillView => p !== null);
  const extra = stillToInvoicePill(row);
  return <div className="pills">{pills.map((p, i) => <Pill key={i} p={p} estimateId={row.estimateId} />)}{extra ? <Pill p={extra} estimateId={row.estimateId} /> : null}</div>;
}

/** The context line: start timing, opens, booking. ("Last messaged" arrives with Step 4.) */
function Context({ row }: { row: JobMoneyRow }) {
  const bits: React.ReactNode[] = [];
  const lead = row.next?.lead ?? null;
  if (row.health === "need" || row.health === "noinv" || (row.next?.slot === "deposit" && row.health === "over")) {
    const hot = row.underWay || (row.lane === "pre_start" && row.startsInDays !== null && row.startsInDays <= 3);
    bits.push(<b key="s" className={hot ? "hot" : ""}>{startText(row)}</b>);
  }
  if (lead?.sent) bits.push(lead.views ? `Invoice opened ${plural(lead.views, "time")}` : "Invoice not opened yet");
  if (row.lane === "offered" && lead && !lead.sent) bits.push("Not booked in yet");
  if (!bits.length) return null;
  return <div className="ctx">{bits.map((b, i) => <span key={i}>{i ? " · " : ""}{b}</span>)}</div>;
}

/** The row's buttons (§4.3): one spec from the server, the clicks in ActionsClient. */
export function Actions({ row, small = false }: { row: JobMoneyRow; small?: boolean }) {
  return <RowActions spec={actionSpec(row, jobHref(row))} small={small} />;
}

export function JobCard({ row }: { row: JobMoneyRow }) {
  const owe = oweOf(row);
  const tone = row.health === "need" || row.health === "noinv" ? "need" : row.health === "over" ? "over" : "";
  return (
    <article className={`job ${tone}${row.pulse ? " pulse" : ""}`} data-estimate={row.estimateId}>
      <div>
        <div className="who">
          <div>
            <div className="addr"><Link href={jobHref(row)}>{row.address}</Link></div>
            <div className="cust">{row.customer || "Customer on the work order"}{row.contractor ? ` · ${row.contractor}` : ""}</div>
          </div>
          <div className="amt">{owe.amount ? <span className={`owe ${owe.state}`}>{owe.amount}</span> : null}<small>{owe.label}</small></div>
        </div>
        <Context row={row} />
      </div>
      <div className="track">
        <div className="trk-h"><b>{STAGE_NAME[row.lane]}</b><span>{money(row.paidCents)} paid of {money(row.contractCents)}</span></div>
        <Rail row={row} />
        <Pills row={row} />
        <DepositAdjust spec={actionSpec(row, jobHref(row))} />
      </div>
      <div className="act"><Actions row={row} /></div>
    </article>
  );
}

/** The D / P / F lights on a board card. */
export function Lights({ row }: { row: JobMoneyRow }) {
  return <>{SLOTS.filter((k) => k !== "progress" || row.slots.progress.state !== "none").map((k) => (
    <span key={k} className={`lt ${row.slots[k].state}`} title={SLOT_NAME[k]}>{SLOT_LETTER[k]}</span>
  ))}</>;
}
