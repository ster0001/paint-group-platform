"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PulseKey, PulseTiles, TradePropertyCard } from "@/lib/portal/tradePortfolio";

/**
 * Session 3 · The interactive half of the portfolio: pulse tiles filter the
 * property list, the search bar matches address / reference value / job
 * number. Every number and card arrives fully derived — nothing is computed
 * here (the one-source rule).
 */
export default function PortfolioList({ pulse, cards }: { pulse: PulseTiles; cards: TradePropertyCard[] }) {
  const [filter, setFilter] = useState<PulseKey | null>(null);
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards
      .filter((c) => !filter || c.pulseKeys.includes(filter))
      .filter((c) => !needle || c.haystack.includes(needle));
  }, [cards, filter, q]);

  const tile = (key: PulseKey, n: number, label: string, cls: string) => (
    <button
      type="button"
      className={`${cls} ${filter === key ? "on" : ""}`}
      onClick={() => setFilter(filter === key ? null : key)}
      data-testid={`pulse-${key}`}
      aria-pressed={filter === key}
    >
      <span className="n">{n}</span>
      <span className="l">{label}</span>
    </button>
  );

  return (
    <>
      <div className="pulse">
        {tile("onsite", pulse.onSite, "On site now", "cy")}
        {tile("approval", pulse.needApproval, "Need your approval", "am")}
        {tile("signoff", pulse.readyToSignOff, "Ready to sign off", "em")}
        {tile("overdue", pulse.overdue, "Invoices overdue", "cl")}
      </div>

      <div className="row" style={{ margin: "14px 0 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Properties</h2>
        <span className="chip mut nodot">{cards.length} {cards.length === 1 ? "property" : "properties"}</span>
      </div>
      <input
        className="searchbar"
        placeholder="Search by address, reference or job number"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="portfolio-search"
      />

      {visible.length === 0 && (
        <div className="card"><p className="sub">Nothing matches — clear the search or the tile filter above.</p></div>
      )}
      {visible.map((c) => (
        <Link className="card propcard" key={c.id} href={`/account/properties/${c.id}`} data-testid={`prop-${c.id}`}>
          <div className="row" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div className="addr" style={{ fontWeight: 600 }}>{c.address}</div>
            <span className={`chip ${c.chip.cls} nodot`} style={{ flex: "none" }}>{c.chip.label}</span>
          </div>
          {c.refLine && <div className="refline">{c.refLine}</div>}
          {c.swatches.length > 0 && (
            <div className="swstrip" data-testid={`swatches-${c.id}`}>
              {c.swatches.map((hex, i) =>
                hex ? <i key={i} style={{ background: hex }} /> : <i key={i} className="neutral" />)}
            </div>
          )}
          <p className="sub" style={{ fontSize: 12.5, margin: "6px 0 0" }}>{c.summary}</p>
          {c.progressPct != null && (
            <div className="pbar" data-testid={`progress-${c.id}`}><i style={{ width: `${c.progressPct}%` }} /></div>
          )}
        </Link>
      ))}

      <Link className="btn btn-ghost" href="/account/addresses/new" style={{ marginTop: 4 }}>
        + Add a property
      </Link>
    </>
  );
}
