import Link from "next/link";
import { FAMILY_LABEL, type Family } from "@/lib/reporting/metrics/activity";
import type { ActivityRow } from "@/lib/reporting/metrics/activity";

/**
 * Session 3 — Activity (mockup `.feed`). Server component. The family chips
 * and the search box are links / a GET form, so the URL is the state and the
 * export link carries the same filters (the export is the filtered rows).
 */
const stamp = (iso: string, now: Date) => {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Australia/Melbourne" });
  const dayF = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = dayF.format(now); const that = dayF.format(d);
  const yest = dayF.format(new Date(now.getTime() - 86_400_000));
  if (that === today) return fmt.format(d);
  if (that === yest) return `Yest ${fmt.format(d)}`;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }).format(d);
};

export default function ActivityFeed({ rows, total, families, family, q, hrefFor, exportHref, now }: {
  rows: ActivityRow[]; total: number; families: Family[]; family: string | null; q: string | null;
  hrefFor: (params: { family?: string | null; q?: string | null }) => string; exportHref: string; now: Date;
}) {
  return (
    <div className="card" data-testid="activity-feed">
      <div className="filters">
        <Link href={hrefFor({ family: null })} className="chip" aria-pressed={!family} data-testid="activity-family-all">All</Link>
        {families.map((f) => <Link key={f} href={hrefFor({ family: f })} className="chip" aria-pressed={family === f} data-testid={`activity-family-${f}`}>{FAMILY_LABEL[f]}</Link>)}
        <form action="/home" method="get" className="custom" style={{ width: "auto" }}>
          {family && <input type="hidden" name="family" value={family} />}
          <input type="search" name="q" defaultValue={q ?? ""} placeholder="Customer or detail" aria-label="Filter activity" data-testid="activity-q" />
          <button type="submit" className="chip">Filter</button>
        </form>
        <a className="ex" href={exportHref} data-testid="export-activity.events" style={{ marginLeft: "auto" }}>Export CSV</a>
      </div>
      {rows.length === 0 ? (
        <p className="note">Nothing in this range{family || q ? " with that filter" : ""}.</p>
      ) : (
        <div className="feed">
          {rows.map((r, i) => (
            <div className="ev" key={`${r.at}-${i}`} data-testid="activity-row" data-family={r.family}>
              <div className="t">{stamp(r.at, now)}</div>
              <div>{r.who ? <b>{r.who}</b> : <b>{r.source === "staff" ? "Office" : r.source === "customer" ? "Customer" : "System"}</b>} — {r.label}{r.detail ? <div className="w">{r.detail}</div> : null}</div>
            </div>
          ))}
          {total > rows.length && <p className="note">Showing {rows.length} of {total} — export for all.</p>}
        </div>
      )}
    </div>
  );
}
