import TrackedLink from "../_components/TrackedLink";

/**
 * §4.10 — the trade lane. No real client name until ⚑9.5 (generic
 * `[Agency name]`); the walkthrough destination is ⚑9.5 too, and the trade
 * account is created office-side today, so both buttons stay `#` with a
 * data-todo and still fire their events.
 */
export default function Trade() {
  return (
    <section className="sec trade-sec" id="trade">
      <div className="sweeps" aria-hidden="true" />
      <div className="wrap trade">
        <div className="tbl" aria-label="A trade portfolio, example">
          <div className="mono" style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--color-muted)" }} data-todo="9.5">[Agency name] · 11 properties</span><span style={{ color: "var(--color-cyan)" }}>+ New estimate</span>
          </div>
          <div className="r"><span><b>4/22 High St, Northcote</b><small>PO 4471 · vacate paint</small></span><span className="st" style={{ color: "var(--color-emerald)" }}>On site · day 2</span></div>
          <div className="r"><span><b>9 Clarke St, Thornbury</b><small>PO 4468 · exterior</small></span><span className="st" style={{ color: "var(--color-amber)" }}>Estimate viewed<br />$9,400–$10,200</span></div>
          <div className="r"><span><b>31 Separation St, Northcote</b><small>PO 4462 · touch-up</small></span><span className="st" style={{ color: "var(--color-muted)" }}>Signed off · paid</span></div>
        </div>
        <div>
          <div className="mono" style={{ color: "var(--color-cyan)", marginBottom: 12 }}>For agents, facilities managers and insurers</div>
          <h2>Every property. One login. No chasing.</h2>
          <p className="lead" style={{ marginTop: 14 }}>Upload a floorplan, room measurements or photos and get a price range immediately. Approve or request variations at the click of a button, colours kept on file, one click repaint. All invoices in one place. Built for people running twenty jobs, not one.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
            <TrackedLink href="#" ev="trade_walkthrough" data-todo="9.5" className="btn btn-cyan">Book a 15-minute walkthrough</TrackedLink>
            <TrackedLink href="#" ev="trade_account" data-todo="9.5" className="btn btn-ghost">Open a trade account</TrackedLink>
          </div>
        </div>
      </div>
    </section>
  );
}
