import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { melbourneDate } from "@/lib/workorder/console";
import { loadStaffAvailability, VISIT_COLUMNS } from "@/lib/visits/book";
import { staffGcalStatus } from "@/lib/gcal/staff";
import { readGoogleBusyForStaff, type GoogleBusy, type GoogleRead } from "@/lib/gcal/read";
import type { VisitRow } from "@/lib/visits/types";
import DiaryVisits from "./DiaryVisits";
import GcalCard from "./GcalCard";
import { addDays, melbourneInstantFromLocal, weekStart } from "./time";

export const dynamic = "force-dynamic";

/**
 * Diary (P6, deep dive §4.6.3) — three clearly separate things on one tab:
 * estimate visits by estimator, jobs running, jobs booked. Day or week.
 *
 * The heavy contractor board stays at /pc/schedule; this is the office's day
 * view, not a second scheduler. Visits come from the `visits` table (booked
 * on the record, by the wizard, or by phone), jobs from the work orders.
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
const shortDate = (s: string) => new Intl.DateTimeFormat("en-AU",
  { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${s}T00:00:00Z`));

export default async function DiaryPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string; gcal?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const todayMel = melbourneDate(new Date());
  const view = sp.view === "week" ? "week" : "day";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? "") ? sp.d! : todayMel;
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i)) : [anchor];
  const from = melbourneInstantFromLocal(days[0], "00:00");
  const to = melbourneInstantFromLocal(addDays(days[days.length - 1], 1), "00:00");

  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: wo, error }, { data: visitRows }, staff, gcal] = await Promise.all([
    supabase.from("work_orders")
      .select("id, wo_ref, stage, start_date, end_date, job_address:wo_snapshot->>jobAddress, estimate_id, estimates(account_id, accepted_name, accepted_total_cents)")
      .neq("stage", "closed").order("start_date", { ascending: true, nullsFirst: false }).limit(100),
    supabase.from("visits").select(VISIT_COLUMNS).gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString())
      .neq("status", "cancelled").order("starts_at").limit(500),
    loadStaffAvailability(supabase),
    user ? staffGcalStatus(user.id) : Promise.resolve({ kind: "unconfigured" as const }),
  ]);

  const rows = (error ? [] : (wo ?? [])) as unknown as WoRow[];
  const visits = (visitRows ?? []) as VisitRow[];
  // 8 Sep: what the estimators have in their OWN Google calendars for these
  // days — shown in the lanes so "free" means free. Best effort.
  const googleRead = await readGoogleBusyForStaff(staff.map((s) => s.staffId), from, to).catch(() => ({ busy: [] as GoogleBusy[], reads: {} as Record<string, GoogleRead> }));
  const myRead = user ? googleRead.reads[user.id] : undefined;
  const running = rows.filter((w) => ON_SITE.has(w.stage));
  const upcoming = rows.filter((w) => !ON_SITE.has(w.stage) && w.start_date && w.start_date >= todayMel);
  const record = (w: WoRow) => w.estimates?.account_id ? `/crm/customers/${w.estimates.account_id}` : `/invoicing/job/${w.estimate_id}`;
  const nav = (d: string, v = view) => `/crm/diary?view=${v}&d=${d}`;
  const title = view === "week"
    ? `Week of ${shortDate(days[0])}`
    : anchor === todayMel ? "Today" : shortDate(anchor);

  return (
    <>
      <h2>Diary</h2>
      <p className="sub">Visits and jobs. Where the week actually goes.</p>

      <div className="row" style={{ marginTop: 0, marginBottom: 12, alignItems: "center" }}>
        <div className="chips">
          <Link className="chip" href={nav(addDays(anchor, view === "week" ? -7 : -1))} aria-label="Earlier">‹</Link>
          <Link className="chip on" href={nav(todayMel)} data-testid="diary-today">{title}</Link>
          <Link className="chip" href={nav(addDays(anchor, view === "week" ? 7 : 1))} aria-label="Later">›</Link>
        </div>
        <div className="chips">
          <Link className={`chip ${view === "day" ? "on" : ""}`} href={nav(anchor, "day")} data-testid="view-day">Day</Link>
          <Link className={`chip ${view === "week" ? "on" : ""}`} href={nav(anchor, "week")} data-testid="view-week">Week</Link>
        </div>
      </div>

      <div className="slab">Estimate visits <span className="slabn mono">{visits.filter((v) => v.status === "booked").length}</span><i /></div>
      <DiaryVisits
        lanes={staff.map((s) => ({ staffId: s.staffId, name: s.name, takesVisits: s.takesVisits }))}
        visits={visits}
        days={days}
        google={googleRead.busy}
      />
      <p className="bhint" style={{ margin: "8px 0 16px" }}>
        Book a visit from the customer&rsquo;s record (the Visits panel) — the estimator, the time, and the customer&rsquo;s invite all follow.
        Customers booking online get a morning or afternoon window; the free estimator is picked for them.
      </p>

      <div className="slab">Jobs running <span className="slabn mono">{running.length}</span><i /></div>
      {running.length === 0 && <p className="empty">Nothing on site right now.</p>}
      {running.map((w) => (
        <Link key={w.id} href={record(w)} className="qitem due" style={{ display: "flex" }}>
          <span className="qico" aria-hidden="true">◐</span>
          <span className="qmain">
            <span className="qt">{w.estimates?.accepted_name || w.job_address || w.wo_ref}</span>
            <span className="qb">
              {[w.job_address, w.stage.replace(/_/g, " "), w.end_date ? `runs to ${shortDate(w.end_date)}` : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="qw mono">{money(w.estimates?.accepted_total_cents ?? null)}</span>
        </Link>
      ))}

      <div className="slab">Booked jobs <span className="slabn mono">{upcoming.length}</span><i /></div>
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

      <div style={{ marginTop: 18 }}>
        <GcalCard status={gcal} flash={sp.gcal ?? null} read={myRead ? { kind: myRead.kind, calendars: myRead.kind === "ok" ? myRead.calendars : [] } : null} />
      </div>

      <div className="note">
        Sequencing, crews and offers live on the <Link href="/pc/schedule" style={{ color: "var(--cyan)" }}>scheduling board</Link>.
        No-shows and visits to rebook arrive in Today as work items, not as another list here.
      </div>
    </>
  );
}
