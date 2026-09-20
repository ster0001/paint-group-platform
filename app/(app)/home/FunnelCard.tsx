import type { FunnelData } from "@/lib/reporting/metrics/funnel";

/** Session 3 — Where estimates go (mockup `.funnel`). Server component: numbers in, bars out. */
export default function FunnelCard({ data, exportHref }: { data: FunnelData; exportHref: string }) {
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
      <div className="note">
        {data.median_days_sent_to_accepted != null ? `Median sent-to-accepted: ${data.median_days_sent_to_accepted} days. ` : "No acceptances from these sessions yet. "}
        {data.self_serve_note}
        {" "}<a className="ex" href={exportHref} data-testid="export-funnel.wizard_sessions">Export CSV</a>
      </div>
    </div>
  );
}
