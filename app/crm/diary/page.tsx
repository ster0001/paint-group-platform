import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";

export const dynamic = "force-dynamic";

/**
 * Diary (§4.5) — visits and jobs scheduled; where the week actually goes.
 *
 * The full estimator day view — tomorrow's route with stops in order, the
 * night-before sequencing — belongs to the visit-booking brief, which is not
 * in the repo yet. Until that module lands, the Diary tells the truth it can:
 * jobs booked and jobs running, read from the work orders. Callback requests,
 * no-shows and thin-day warnings will emit WORK ITEMS into Today when visit
 * booking ships, not a list here (§2.5).
 */

type WoRow = {
  id: string;
  wo_ref: string;
  stage: string;
  start_date: string | null;
  end_date: string | null;
  job_address: string | null;
  estimate_id: string;
  estimates: { account_id: string | null; accepted_name: string | null; accepted_total_cents: number | null } | null;
};

const ON_SITE = new Set(["in_progress", "qa", "completion_prep", "walkthrough"]);
const money = (c: number | null) => (c == null ? "—" : "$" + Math.round(c / 100).toLocaleString("en-AU"));
// A date-only column is already a Melbourne calendar day; format it in UTC so
// no zone conversion (and no hand-written offset) can move it.
const shortDate = (s: string) => new Intl.DateTimeFormat("en-AU",
  { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${s}T00:00:00Z`));

export default async function DiaryPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_orders")
    .select("id, wo_ref, stage, start_date, end_date, job_address:wo_snapshot->>jobAddress, estimate_id, estimates(account_id, accepted_name, accepted_total_cents)")
    .neq("stage", "closed")
    .order("start_date", { ascending: true, nullsFirst: false })
    .limit(100);

  const rows = (error ? [] : (data ?? [])) as unknown as WoRow[];
  const todayMel = melbourneDate(new Date());

  const running = rows.filter((w) => ON_SITE.has(w.stage));
  const upcoming = rows.filter((w) => !ON_SITE.has(w.stage) && w.start_date && w.start_date >= todayMel);

  const record = (w: WoRow) =>
    w.estimates?.account_id ? `/crm/customers/${w.estimates.account_id}` : `/invoicing/job/${w.estimate_id}`;

  return (
    <>
      <h2>Diary</h2>
      <p className="sub">Visits and jobs. Where the week actually goes.</p>

      <div className="slab">Jobs running <span className="slabn mono">{running.length}</span><i /></div>
      {running.length === 0 && <p className="empty">Nothing on site right now.</p>}
      {running.map((w) => (
        <Link key={w.id} href={record(w)} className="qitem due" style={{ display: "flex" }}>
          <span className="qico" aria-hidden="true">◐</span>
          <span className="qmain">
            <span className="qt">{w.estimates?.accepted_name || w.job_address || w.wo_ref}</span>
            <span className="qb">
              {[w.job_address, w.stage.replace(/_/g, " "),
                w.end_date ? `runs to ${shortDate(w.end_date)}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="qw mono">{money(w.estimates?.accepted_total_cents ?? null)}</span>
        </Link>
      ))}

      <div className="slab">Booked <span className="slabn mono">{upcoming.length}</span><i /></div>
      {upcoming.length === 0 && <p className="empty">Nothing booked ahead. Accepted jobs appear here once they have a start date.</p>}
      {upcoming.map((w) => (
        <Link key={w.id} href={record(w)} className="qitem ok" style={{ display: "flex" }}>
          <span className="qico" aria-hidden="true">▸</span>
          <span className="qmain">
            <span className="qt">{w.estimates?.accepted_name || w.job_address || w.wo_ref}</span>
            <span className="qb">{[w.job_address, w.stage.replace(/_/g, " ")].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="qw mono">{w.start_date ? shortDate(w.start_date) : "—"}</span>
        </Link>
      ))}

      <div className="note">
        Sequencing, crews and offers live on the <Link href="/pc/schedule" style={{ color: "var(--cyan)" }}>scheduling board</Link>.
        Estimator visits land here when visit booking ships — and its callbacks and no-shows will
        arrive in Today as work items, not as another list.
      </div>
    </>
  );
}
