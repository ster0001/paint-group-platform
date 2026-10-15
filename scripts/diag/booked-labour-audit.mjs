// READ ONLY: every job with painters booked on it — booked days × hours × the
// painter's cost rate versus the labour cost the job panel shows today
// (Tom, 15 Oct 2026: 12 First Avenue's outgoing labour was short).
//
// Rule audited: every Monday–Friday (public holidays excluded) inside a
// painter's assignment is a work day at the standard day's hours
// (timesheet_day_setting) × the painter's cost rate on that day. Weekends
// count only when the office recorded one. Subcontractors (employment_type
// contractor) have no hourly cost rate — they are paid the offer on the work
// order — so they are listed with the offer and no day arithmetic.
//
// Run from the MAIN checkout (it has .env.local and node_modules):
//   node <worktree>/scripts/diag/booked-labour-audit.mjs --prod
// Without --prod it reads the test project (.env.test.local, C1_DATABASE_URL).
// Runs inside a READ ONLY transaction and writes nothing.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "package.json"));
const pg = require("pg");
pg.types.setTypeParser(1082, (v) => v); // date → "YYYY-MM-DD", never a local Date
const prod = process.argv.includes("--prod");
const file = prod ? ".env.local" : ".env.test.local";
const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const url = prod ? (env.IMPORT_DATABASE_URL || env.DATABASE_URL) : env.C1_DATABASE_URL;
if (!url) { console.error(`no connection string in ${file}`); process.exit(1); }

const c = new pg.Client({ connectionString: url, ssl: prod ? { rejectUnauthorized: false } : undefined });
await c.connect();
await c.query("begin read only");
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const [{ today }] = await q(`select (now() at time zone 'Australia/Melbourne')::date::text as today`);
const [day] = await q(`select * from timesheet_day_setting()`);
const [{ hours }] = await q(`select timesheet_hours(('2000-01-01 ' || $1)::timestamp, ('2000-01-01 ' || $2)::timestamp, $3)::float as hours`, [day.day_start, day.day_finish, day.break_minutes]);
const holidays = new Set(((await q(`select coalesce(value->'publicHolidays', '[]'::jsonb) h from settings where key = 'visit_booking_rules'`))[0]?.h ?? []));

const jobs = await q(`
  select w.id, w.job_no, w.wo_ref, w.stage::text, w.wo_snapshot->>'jobAddress' as address,
         coalesce((w.wo_snapshot->>'contractorPaymentCents')::int, 0) as snapshot_offer_cents,
         wo_is_employee_job(w.id) as employee_job,
         (select p.name from contractors c join profiles p on p.id = c.profile_id where c.id = w.contractor_id) as contractor,
         (select c.employment_type from contractors c where c.id = w.contractor_id) as contractor_type,
         w.start_date::text as start_date, w.end_date::text as end_date
    from work_orders w
   where exists (select 1 from wo_assignments a where a.work_order_id = w.id and a.status <> 'released')
      or w.contractor_id is not null
   order by w.job_no`);

const weekday = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
const nextDay = (ymd) => new Date(Date.parse(ymd + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
const money = (cents) => (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const rows = [];
for (const j of jobs) {
  const painters = await q(`
    select a.contractor_id, p.name, c.employment_type, a.start_date::text as start_date, a.end_date::text as end_date
      from wo_assignments a join contractors c on c.id = a.contractor_id left join profiles p on p.id = c.profile_id
     where a.work_order_id = $1 and a.status <> 'released' order by a.start_date, p.name`, [j.id]);
  const entries = await q(`
    select t.contractor_id, t.work_date::text as work_date, t.status, t.job_cost_id,
           timesheet_hours(t.started_at, t.finished_at, t.break_minutes)::float as hours,
           (select jc.amount_ex_cents from job_costs jc where jc.id = t.job_cost_id and jc.status in ('approved', 'paid')) as cost_cents
      from timesheet_entries t where t.work_order_id = $1 and t.status <> 'rejected'`, [j.id]);
  const [{ panel_labour_cents }] = await q(`select coalesce(sum(amount_ex_cents), 0)::int as panel_labour_cents from job_costs where work_order_id = $1 and category = 'labour' and status in ('approved', 'paid')`, [j.id]);

  let expected = 0, bookedDays = 0, pastDays = 0, futureDays = 0, missingRateDays = 0;
  const byPainter = [];
  for (const p of painters) {
    if (p.employment_type !== "employee") { byPainter.push(`${p.name} (subcontractor, no hourly rate)`); continue; }
    let days = 0, cents = 0, noRate = 0;
    for (let d = p.start_date; d <= p.end_date; d = nextDay(d)) {
      const wd = weekday(d);
      if (wd === 0 || wd === 6 || holidays.has(d)) continue;
      days += 1; bookedDays += 1;
      if (d <= today) pastDays += 1; else futureDays += 1;
      const [{ rate }] = await q(`select employee_cost_rate_on($1, $2::date) as rate`, [p.contractor_id, d]);
      const actual = entries.find((e) => e.contractor_id === p.contractor_id && e.work_date === d && e.cost_cents != null);
      if (actual) { cents += actual.cost_cents; continue; }
      if (rate == null) { noRate += 1; missingRateDays += 1; continue; }
      cents += Math.round(hours * rate);
    }
    expected += cents;
    byPainter.push(`${p.name}: ${days} days${noRate ? `, ${noRate} with NO RATE` : ""} = ${money(cents)}`);
  }
  const waiting = entries.filter((e) => e.status === "submitted").length;
  const offerCounted = j.employee_job ? j.snapshot_offer_cents : 0;
  const flags = [];
  if (missingRateDays) flags.push("no cost rate");
  if (futureDays) flags.push(`${futureDays} booked days ahead not costed`);
  if (waiting) flags.push(`${waiting} days waiting (submitted)`);
  if (offerCounted) flags.push(`estimate offer ${money(offerCounted)} counted as a contractor cost on an employee job`);
  if (j.employee_job && expected !== panel_labour_cents) flags.push(`labour short by ${money(expected - panel_labour_cents)}`);
  rows.push({
    job: `PG-${String(j.job_no).padStart(4, "0")} ${j.wo_ref}`, address: j.address, stage: j.stage,
    booked: painters.length ? `${j.start_date ?? "?"} → ${j.end_date ?? "?"}` : "—",
    kind: j.employee_job ? "employees" : painters.length ? "mixed" : "subcontractor",
    painters: byPainter.length ? byPainter : j.contractor ? [`${j.contractor} (${j.contractor_type}, offer ${money(j.snapshot_offer_cents)})`] : [],
    bookedDays, pastDays, futureDays,
    shouldShow: j.employee_job ? money(expected) : money(j.snapshot_offer_cents),
    panelShows: j.employee_job ? `${money(panel_labour_cents)} labour + ${money(offerCounted)} offer` : money(j.snapshot_offer_cents),
    flags,
  });
}
await c.query("rollback");
await c.end();

console.log(`# Booked labour audit — ${prod ? "PRODUCTION" : "test project"}, read ${new Date().toISOString()}, standard day ${hours} h, today ${today}\n`);
console.log("| Job | Address | Stage | Booked | Kind | Painters | Days (past/ahead) | Should show | Panel shows now | Flags |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.job} | ${r.address ?? ""} | ${r.stage} | ${r.booked} | ${r.kind} | ${r.painters.join("<br>")} | ${r.bookedDays} (${r.pastDays}/${r.futureDays}) | ${r.shouldShow} | ${r.panelShows} | ${r.flags.join("; ") || "ok"} |`);
console.log(`\n${rows.filter((r) => r.flags.length).length} of ${rows.length} jobs flagged.`);
