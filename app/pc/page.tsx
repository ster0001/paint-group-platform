import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadConsole } from "@/lib/workorder/consoleData";
import { buildQueue, headline, pulseTiles, sparkline } from "@/lib/workorder/console";
import ReofferDialog from "./ReofferDialog";

export const dynamic = "force-dynamic";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");

const ICON: Record<string, string> = {
  reoffer: "⚑", call: "◌", price: "◐", open: "◔", ring: "◷",
  review: "✎", nudge: "◑", extension: "◓",
};

const age = (hours: number) =>
  hours < 1 ? "now" : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;

export default async function CommandPage() {
  const supabase = await createClient();
  const { input, signedOffThisWeek, ticksByDay } = await loadConsole(supabase);

  const queue = buildQueue(input);

  // Who a lapsed job can go to: compliant contractors only. send_offer enforces
  // it too, but offering someone who will be refused is a wasted tap.
  const { data: offerable } = await supabase
    .from("contractors").select("id, company_name").eq("offerable", true).eq("active", true);
  const targets = ((offerable ?? []) as { id: string; company_name: string }[])
    .map((c) => ({ id: c.id, name: c.company_name || "Unnamed contractor" }));
  const tiles = pulseTiles(input, queue, signedOffThisWeek);
  const head = headline(tiles);
  const line = sparkline(ticksByDay, input.now);

  const max = Math.max(1, ...line);
  const points = line
    .map((v, i) => `${2 + i * 9},${26 - (v / max) * 20}`)
    .join(" ");

  return (
    <>
      <div>
        <h1>{head.top}<br />{head.bottom}</h1>
        <p className="lede">
          Everything below is read from the work-order model — no typed statuses,
          no stale boards.
        </p>
      </div>

      <div className="pulse">
        <div className="tile">
          <span className="k">On the books</span>
          <span className="v" data-testid="tile-books">{money(tiles.onTheBooksCents)}</span>
          <span className="s">inc GST · {tiles.openJobs} open job{tiles.openJobs === 1 ? "" : "s"}</span>
        </div>
        <div className="tile crit">
          <span className="k">Critical</span>
          <span className="v" data-testid="tile-critical">{tiles.critical}</span>
          <span className="s">SLA breach · silent site</span>
        </div>
        <div className="tile warn">
          <span className="k">Waiting on you</span>
          <span className="v" data-testid="tile-waiting">{tiles.waiting}</span>
          <span className="s">price · colours · nudge · drafts</span>
        </div>
        <div className="tile good">
          <span className="k">Signed off this week</span>
          <span className="v" data-testid="tile-signed">{tiles.signedOffThisWeek}</span>
          <span className="s">from the event log</span>
        </div>
      </div>

      <div className="sect">
        <div className="sect-h">
          <h2>Needs you now</h2><span>ranked · worst first</span>
          <svg className="spark" width="120" height="30" viewBox="0 0 120 30" role="img"
            aria-label="Ticks logged per day, last 14 days">
            <polyline points={points} fill="none" stroke="#3BD8E9" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
          </svg>
        </div>

        <div className="stack" data-testid="queue">
          {queue.map((card) => (
            <div className={`al al-${card.severity === "critical" ? "crit" : card.severity === "warning" ? "warn" : "info"}`}
              key={card.key} data-testid={`card-${card.key}`}>
              <span className="rail" />
              <span className="ic">{ICON[card.action.kind] ?? "•"}</span>
              <div className="bd">
                <div className="hd">
                  <strong>{card.title}</strong>
                  <span className="ref">{card.ref}</span>
                </div>
                <p>{card.detail}</p>
              </div>
              <span className="tm">{age(card.ageHours)}</span>
              {card.action.kind === "reoffer" && card.offerId ? (
                <span data-testid={`action-${card.key}`}>
                  <ReofferDialog
                    offerId={card.offerId}
                    jobTitle={card.ref}
                    lapsedName={card.detail.split(" has had it")[0]}
                    contractors={targets}
                    defaultStart={new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}
                  />
                </span>
              ) : (
                <Link className={`btn ${card.severity === "critical" ? "primary" : ""}`}
                  href={card.action.href ?? `/pc/wo/${card.workOrderId}`}
                  data-testid={`action-${card.key}`}>
                  {card.action.label}
                </Link>
              )}
            </div>
          ))}

          {queue.length === 0 && (
            <p className="empty" data-testid="queue-empty">
              Nothing needs you. Every job is where it should be.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
