import type { FunnelData, GateVersionReport, WizardRates } from "@/lib/reporting/metrics/funnel";

/** Session 3 — Where estimates go (mockup `.funnel`). Server component: numbers in, bars out. */
export default function FunnelCard({ data, exportHref, gate = [], gateExportHref = "", rates = null }: { data: FunnelData; exportHref: string; gate?: GateVersionReport[]; gateExportHref?: string;
  /** Wizard mobile v5 §8: gate → exact price and Contact → booked, in sessions. Drawn once a session has reached either. */
  rates?: WizardRates | null }) {
  return (
    <div className="card" data-testid="funnel-card">
      <div className="funnel">
        {data.steps.map((s) => (
          <div className="frow" key={s.key} data-testid={`funnel-${s.key}`}>
            <span>{s.label}</span>
            <div className="b"><i className={s.key === "accepted" ? "gold" : ""} style={{ width: `${s.pct_of_start}%` }} /></div>
            <span className="n" data-testid={`funnel-count-${s.key}`}>{s.count}</span>
            {s.drop_note && <span className="drop"><b>{s.drop_note.split(" — ")[0]}</b>{s.drop_note.includes(" — ") ? ` — ${s.drop_note.split(" — ")[1]}` : ""}</span>}
          </div>
        ))}
      </div>
      {/* Wizard mobile v5 §8: the hinge of the platform, as two rates — sessions, never taps. */}
      {rates && (rates.gate_viewed > 0 || rates.contact_opened > 0) && (
        <p className="funnel-rates" data-testid="funnel-rates" style={{ margin: "12px 0 0", fontSize: 13 }}>
          <span data-testid="funnel-rate-gate">Range → exact price: <b>{rates.gate_exact}</b> of {rates.gate_viewed} session{rates.gate_viewed === 1 ? "" : "s"}{rates.gate_exact_pct != null ? ` (${rates.gate_exact_pct}%)` : ""}</span>
          {" · "}
          <span data-testid="funnel-rate-contact">Contact → booked: <b>{rates.contact_booked}</b> of {rates.contact_opened}{rates.contact_booked_pct != null ? ` (${rates.contact_booked_pct}%)` : ""}</span>
        </p>
      )}
      {/* S6 (§4.7): the gate, by version — reached, completed, lost, saw the range, what next. */}
      {gate.length > 0 && (
        <div className="funnel-gate" data-testid="funnel-gate" style={{ marginTop: 12 }}>
          <table style={{ width: "100%", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", opacity: 0.7 }}><th>The gate</th><th>Sessions</th><th>Reached</th><th>Completed</th><th>Lost at the gate</th><th>Saw the range</th><th>Tighten</th><th>Speak</th><th>Visit</th><th>Message</th></tr></thead>
            <tbody>
              {gate.map((g) => (
                <tr key={g.version} data-testid={`funnel-gate-${g.version}`}>
                  <td>{g.label}</td><td data-testid="gate-sessions">{g.sessions}</td><td data-testid="gate-reached">{g.reached_gate}</td><td data-testid="gate-completed">{g.completed_gate}</td>
                  <td data-testid="gate-lost">{g.lost_at_gate_pct}%</td><td data-testid="gate-range">{g.saw_range}</td>
                  <td>{g.next.tighten}</td><td>{g.next.speak}</td><td>{g.next.visit}</td><td>{g.next.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {gateExportHref && <a className="ex" href={gateExportHref} data-testid="export-funnel.gate_sessions">Export CSV</a>}
        </div>
      )}
      <div className="note">
        {data.median_days_sent_to_accepted != null ? `Median sent-to-accepted: ${data.median_days_sent_to_accepted} days. ` : "No acceptances from these sessions yet. "}
        {data.self_serve_note}
        {" "}<a className="ex" href={exportHref} data-testid="export-funnel.wizard_sessions">Export CSV</a>
      </div>
    </div>
  );
}
