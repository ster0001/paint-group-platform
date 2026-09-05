import Link from "next/link";
import { buildBoard } from "@/lib/crm/board";
import type { CustomerInput } from "./data";

const money = (c: number) => "$" + Math.round(c / 100).toLocaleString("en-AU");
const compact = (c: number) => (c >= 100_000_00 ? `$${Math.round(c / 100_000) / 10}k` : money(c));

/**
 * The board — a view mode inside Customers (§2.1), not a destination. Nothing
 * here is stored: every card's lane comes from `stageFor`, which reads the
 * estimates, work orders and events. Which is why there is no drag handle on
 * a card, and why the header says so out loud.
 */
export default function BoardView({ input }: { input: CustomerInput[] }) {
  const board = buildBoard(input);

  return (
    <>
      <div className="tiles">
        <div className="tile"><b>{board.tiles.overdueFollowups}</b><span>Overdue follow-up</span></div>
        <div className="tile"><b>{board.tiles.goingCold}</b><span>Going cold</span></div>
        <div className="tile"><b>{compact(board.tiles.openValueCents)}</b><span>Open estimate value</span></div>
        <div className="tile">
          <b>{board.tiles.winRatePct == null ? "—" : `${board.tiles.winRatePct}%`}</b>
          <span>{board.tiles.winRatePct == null ? "Nothing decided yet" : `Win rate, 90 days · ${board.tiles.winRateOf} decided`}</span>
        </div>
      </div>

      <div className="lanescroll">
        {board.lanes.map((lane) => (
          <div className="lane" key={lane.key}>
            <div className="lanehead">
              <span className="lanename">{lane.label}</span>
              <span className="lanecount mono">{lane.cards.length}</span>
            </div>
            <div className="lanebar">
              <i style={{ width: `${lane.cards.length === 0 ? 0 : Math.min(100, lane.cards.length * 18)}%` }} />
            </div>

            {lane.cards.length === 0 && <p className="laneempty">Nobody here</p>}

            {lane.cards.map((c) => (
              <Link
                key={c.accountId}
                href={`/crm/customers/${c.accountId}`}
                className={`card ${c.chips.includes("Follow-up overdue") ? "warnclay" : c.needsYou ? "warnamber" : ""}`}
              >
                <span className="cname">
                  {c.temperature && <i className={`dot ${c.temperature}`} aria-hidden="true" />}
                  {c.name}
                </span>
                <span className="cmeta">{c.meta}</span>
                <span className="cfoot">
                  <b className="cval">{c.valueCents ? money(c.valueCents) : "—"}</b>
                  <span className="cwhen mono">{c.because}</span>
                </span>
                {(c.chips.length > 0 || c.source) && (
                  <span className="cchips">
                    {c.chips.map((chip) => (
                      <i key={chip} className={`cchip ${chip === "Follow-up overdue" || chip === "Worth a call now" || chip === "Needs help" ? "bad" : chip.startsWith("Ready") ? "" : "warn"}`}>{chip}</i>
                    ))}
                    {c.source && <i className="cchip">{c.source}</i>}
                  </span>
                )}
                {c.wantsCall && (
                  <span className="cnote" style={{ fontStyle: "normal" }}>
                    {c.callWhy.join(" · ")}{c.phone ? ` — ${c.phone}` : ""}
                  </span>
                )}
                {c.note && <span className="cnote">&ldquo;{c.note}&rdquo;</span>}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <p className="swipe">Seven lanes — scroll across →</p>
    </>
  );
}
