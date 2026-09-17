import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { accessTokenFor, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS, findMoneyKeys } from "../lib/painters/money";

/**
 * Employed painters — Session 6: timesheets + job cost (brief §6 Session 6
 * acceptance).
 *
 *  · Start day / Finish day in the portal: two taps, hours only.
 *  · A 7.6 h day recorded by the office and approved posts ONE labour line at
 *    the painter's cost rate on the job money view ($52.50 × 7.6 = $399.00);
 *    the PC job page's GP moves by exactly that.
 *  · The payroll CSV matches approved entries exactly — and carries no rate.
 *  · No pay or rate figure reaches the painter: not the page, not a direct
 *    read of their own rows, not the rate table.
 *  · Approval refuses without a rate covering the day.
 *
 * Every account and row made here is removed at the end.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const run = Date.now().toString(36);
const employee = { email: `pg.e2e.employee.${run}.clock@example.com`, password: `Employee-${run}-pw!` };
const norate = { email: `pg.e2e.employee.${run}.norate@example.com`, password: `Employee-${run}-pw!` };
const PAINTER_NAME = "E2E Clock Employee";
const RATE_CENTS = 5250;
const CONTRACT_CENTS = 200_000;
const ids: { user: string; contractor: string }[] = [];
let fixture: LoopFixture | null = null;
let employeeCid = "";
let norateCid = "";
let recordedId = "";
let labourCostId = "";

const melbourneDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const today = melbourneDay(new Date());
const tomorrow = (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

async function makePainter(creds: { email: string; password: string }, name: string) {
  const created = await db!.auth.admin.createUser({ email: creds.email, password: creds.password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  const uid = created.data.user.id;
  const role = await db!.from("profiles").update({ role: "contractor", name }).eq("id", uid);
  if (role.error) throw new Error(role.error.message);
  const c = await db!.from("contractors").insert({ profile_id: uid, tier: "B", active: true, company_name: "", employment_type: "employee" }).select("id").single();
  if (c.error) throw new Error(c.error.message);
  ids.push({ user: uid, contractor: (c.data as { id: string }).id });
  return (c.data as { id: string }).id;
}

async function readAsEmployee(path: string): Promise<{ rows: unknown[] | null; error: { code?: string } | null }> {
  const token = await accessTokenFor(employee);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  return Array.isArray(body) ? { rows: body, error: null } : { rows: null, error: body };
}

test.describe("employed painter — timesheets and job cost", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the accounts");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const flag = await db!.from("settings").upsert({ key: "employees_enabled", value: { enabled: true } }, { onConflict: "key" });
    if (flag.error) throw new Error(flag.error.message);
    employeeCid = await makePainter(employee, PAINTER_NAME);
    norateCid = await makePainter(norate, "E2E NoRate Employee");

    fixture = await createLoopFixture(db!, employeeCid, [{ heading: "Kitchen", labels: ["Walls"] }]);
    // A contract value, so the PC page's GP has something to move from.
    const est = await db!.from("estimates").update({ total_cents: CONTRACT_CENTS }).eq("id", fixture.estimateId);
    if (est.error) throw new Error(est.error.message);
    await db!.from("work_orders").update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" }).eq("id", fixture.workOrderId);
    // Both on the job TODAY, so "Start day" with no job named finds it.
    const r = await rpcAs(staff!, "assign_job", {
      p_work_order_id: fixture.workOrderId,
      p_painters: [
        { contractor_id: employeeCid, start_date: today, end_date: tomorrow },
        { contractor_id: norateCid, start_date: today, end_date: tomorrow },
      ],
      p_lead_contractor_id: employeeCid,
    });
    if (!r.startsWith("ok:")) throw new Error(`assign_job: ${r}`);
    // The rate, dated well before any day it will price.
    const rate = await rpcAs(staff!, "set_employee_cost_rate", { p_contractor_id: employeeCid, p_cents_per_hour: RATE_CENTS, p_effective_from: "2026-01-01" });
    if (!rate.startsWith("ok:")) throw new Error(`set_employee_cost_rate: ${rate}`);
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    for (const { contractor } of ids) {
      // Rates and entries cascade from the contractor; the fixture already took the job's rows.
      const r = await db!.from("contractors").delete().eq("id", contractor);
      if (r.error) throw new Error(`teardown contractors: ${r.error.message}`);
    }
    for (const { user } of ids) {
      const r = await db!.auth.admin.deleteUser(user);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("Start day, Finish day: two taps, hours only, and nothing in dollars on the page", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await expect(page.getByTestId("timesheet-card")).toBeVisible();
    // S7b: the standard day logs itself; Start day is behind a second tap, for a two-job day.
    await expect(page.getByTestId("timesheet-auto-note")).toContainText(/logged for you/);
    await page.getByTestId("timesheet-clock-open").click();
    await page.getByTestId("timesheet-start").click();
    await expect(page.getByTestId("timesheet-running")).toBeVisible({ timeout: 15_000 });

    // A day that ran for two hours (the clock, not a wait).
    const { data: open } = await db!.from("timesheet_entries").select("id, started_at, status, source").eq("contractor_id", employeeCid).eq("status", "open").single();
    expect(open).not.toBeNull();
    const openRow = open as { id: string; started_at: string; source: string };
    expect(openRow.source).toBe("painter");
    const back = new Date(new Date(openRow.started_at).getTime() - 2 * 3_600_000).toISOString();
    const nudge = await db!.from("timesheet_entries").update({ started_at: back }).eq("id", openRow.id);
    if (nudge.error) throw new Error(nudge.error.message);

    // A second Start refuses — one open day per painter.
    expect(await rpcAs(employee, "timesheet_start", { p_work_order_id: fixture!.workOrderId })).toBe("error:already_started");

    await page.reload();
    await page.getByTestId("timesheet-break").selectOption("30");
    await page.getByTestId("timesheet-finish").click();
    await expect(page.getByTestId("timesheet-done")).toContainText(/1\.5 hours sent to the office/, { timeout: 15_000 });
    await expect(page.getByTestId(`timesheet-entry-${openRow.id}`)).toContainText(/1\.5 h.*With the office|With the office/);

    const { data: sub } = await db!.from("timesheet_entries").select("status, break_minutes, finished_at").eq("id", openRow.id).single();
    expect((sub as { status: string }).status).toBe("submitted");
    expect((sub as { break_minutes: number }).break_minutes).toBe(30);

    // The painter's own pages: no money key, no dollar figure.
    const html = await page.content();
    for (const key of KNOWN_MONEY_KEYS) expect(html, `leaked ${key}`).not.toContain(key);
    expect(await page.locator("body").innerText()).not.toMatch(/\$\s?\d/);
    // Their own rows, read directly: hours, never a rate.
    const own = await readAsEmployee(`timesheet_entries?select=*`);
    expect(own.error).toBeNull();
    expect(own.rows?.length).toBe(1);
    expect(findMoneyKeys(own.rows)).toEqual([]);
    const rates = await readAsEmployee(`employee_cost_rates?select=id,cents_per_hour`);
    if (rates.rows) expect(rates.rows).toEqual([]);
    else expect(rates.error?.code).toMatch(/^42501$|^PGRST/);
  });

  test("the office records a 7.6 h day and approves it: one labour line at the cost rate on the job, and GP moves by exactly that", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc/timesheets");
    await expect(page.getByTestId("record-hours")).toBeVisible();
    await page.getByTestId("record-painter").selectOption({ label: PAINTER_NAME });
    await page.getByTestId("record-job").selectOption({ index: 0 });
    await page.getByTestId("record-date").fill(today);
    await page.getByTestId("record-start").fill("07:00");
    await page.getByTestId("record-finish").fill("15:06");
    await page.getByTestId("record-break").selectOption("30");
    await page.getByTestId("record-submit").click();
    await expect(page.getByTestId("record-msg")).toContainText(/Recorded/, { timeout: 15_000 });

    const { data: rec } = await db!.from("timesheet_entries").select("id, status, source, work_date")
      .eq("contractor_id", employeeCid).eq("source", "pc").single();
    const recRow = rec as { id: string; status: string; work_date: string };
    recordedId = recRow.id;
    expect(recRow.status).toBe("submitted");
    expect(recRow.work_date).toBe(today);

    // Approve from the list.
    await page.reload();
    await expect(page.getByTestId(`timesheet-hours-${recordedId}`)).toContainText("7.60 h");
    await expect(page.getByTestId(`timesheet-norate-${recordedId}`)).toHaveCount(0);
    await page.getByTestId(`timesheet-approve-${recordedId}`).click();
    await expect(page.getByTestId(`timesheet-approved-${recordedId}`)).toBeVisible({ timeout: 15_000 });

    // ONE labour line, hours × rate, GST 0, pinned to the entry.
    const { data: costs } = await db!.from("job_costs").select("id, category, amount_ex_cents, gst_cents, status, description")
      .eq("work_order_id", fixture!.workOrderId).eq("category", "labour");
    const rows = costs as { id: string; amount_ex_cents: number; gst_cents: number; status: string; description: string }[];
    expect(rows.length).toBe(1);
    labourCostId = rows[0].id;
    expect(rows[0].amount_ex_cents).toBe(39_900);
    expect(rows[0].gst_cents).toBe(0);
    expect(rows[0].status).toBe("approved");
    expect(rows[0].description).toContain(`Labour — ${PAINTER_NAME}`);
    const { data: pinned } = await db!.from("timesheet_entries").select("job_cost_id, status").eq("id", recordedId).single();
    expect((pinned as { job_cost_id: string }).job_cost_id).toBe(labourCostId);
    // Approving again posts nothing more.
    expect(await rpcAs(staff!, "timesheet_approve", { p_entry_id: recordedId })).toBe(`ok:${labourCostId}`);
    const { count } = await db!.from("job_costs").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId).eq("category", "labour");
    expect(count).toBe(1);

    // The job money view shows the line.
    await page.goto(`/invoicing/job/${fixture!.estimateId}`);
    await page.getByRole("button", { name: "Costs" }).click();
    await expect(page.getByTestId(`job-cost-item-${labourCostId}`)).toContainText(`Labour — ${PAINTER_NAME}`);
    await expect(page.getByTestId(`job-cost-item-${labourCostId}`)).toContainText("$399.00");

    // The PC job page: labour shown, GP down by exactly the line.
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);
    await expect(page.getByTestId("money-labour")).toHaveText("$399");
    const expectedGp = Math.round(((CONTRACT_CENTS - 39_900) / CONTRACT_CENTS) * 1000) / 10;
    await expect(page.getByTestId("money-gp")).toHaveText(`${expectedGp}%`);

    // Allocated vs actual lists the job with the approved hours.
    await page.goto("/pc/timesheets");
    await expect(page.getByTestId(`ava-actual-${fixture!.workOrderId}`)).toHaveText("7.6 h");
  });

  test("the payroll CSV matches approved entries exactly — hours only, no rate; and it is staff-only", async ({ page, request }) => {
    await signIn(page, staff!, /\/estimates/);
    const res = await page.request.get(`/pc/timesheets/export?from=${today}&to=${today}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("painter,job,date,start,finish,break_minutes,hours,source,approved_at");
    const mine = lines.filter((l) => l.startsWith(`${PAINTER_NAME},`));
    // The approved 7.6 h day, and NOT the 1.5 h day still waiting on approval.
    expect(mine.length).toBe(1);
    const { data: wo } = await db!.from("work_orders").select("wo_ref").eq("id", fixture!.workOrderId).single();
    expect(mine[0]).toContain(`,${(wo as { wo_ref: string }).wo_ref},${today},07:00,15:06,30,7.60,pc,`);
    expect(csv).not.toMatch(/cents|rate|\$|52\.50|399/i);

    // Not staff: the route does not exist.
    const anon = await request.get(`/pc/timesheets/export?from=${today}&to=${today}`);
    expect(anon.status()).toBe(404);
  });

  test("a standard day logs itself for the painter who tapped nothing — once, never on a day already logged", async () => {
    // A weekday inside the assignment (today..tomorrow) that has finished by the standard time — yesterday-proof:
    // the fill refuses a day that has not ended, so pick today only when 15:30 Melbourne has passed.
    const hourNow = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", hour12: false }).format(new Date()));
    const dow = new Date(today + "T12:00:00Z").getUTCDay();
    test.skip(hourNow < 16 || dow === 0 || dow === 6, "the standard day fills after 15:30 on a weekday — run this after then");
    const filled = await rpcAs(staff!, "timesheet_autofill", { p_day: today });
    expect(filled).toMatch(/^ok:/);
    const { data: rows } = await db!.from("timesheet_entries").select("id, source, status, started_at, finished_at, break_minutes")
      .eq("contractor_id", norateCid).eq("work_date", today);
    const auto = (rows as { id: string; source: string; status: string; started_at: string; finished_at: string; break_minutes: number }[]).filter((r) => r.source === "auto");
    expect(auto.length).toBe(1);
    expect(auto[0].status).toBe("submitted");
    expect(auto[0].break_minutes).toBe(30);
    expect(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(auto[0].started_at))).toBe("07:30");
    // The lead already has entries today → nothing added for them; a second run adds nothing for anyone.
    const { count: leadAuto } = await db!.from("timesheet_entries").select("id", { count: "exact", head: true }).eq("contractor_id", employeeCid).eq("source", "auto");
    expect(leadAuto).toBe(0);
    expect(await rpcAs(staff!, "timesheet_autofill", { p_day: today })).toBe("ok:0");
  });

  test("the painter logs extra hours on top of the day, and cannot overlap what is already logged", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await page.getByTestId("timesheet-extra-open").click();
    // The lead's own day today ran two hours ago (test 1) — an overlap is refused.
    const startedAt = (await db!.from("timesheet_entries").select("started_at").eq("contractor_id", employeeCid).eq("source", "painter").order("started_at", { ascending: true }).limit(1).single()).data as { started_at: string };
    const clock = (iso: string, plusMin: number) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(new Date(iso).getTime() + plusMin * 60_000));
    await page.getByTestId("timesheet-extra-start").fill(clock(startedAt.started_at, 10));
    await page.getByTestId("timesheet-extra-finish").fill(clock(startedAt.started_at, 40));
    await page.getByTestId("timesheet-extra-send").click();
    await expect(page.getByTestId("timesheet-error")).toContainText(/overlap/, { timeout: 15_000 });
    // Before that day: fine.
    await page.getByTestId("timesheet-extra-start").fill(clock(startedAt.started_at, -90));
    await page.getByTestId("timesheet-extra-finish").fill(clock(startedAt.started_at, -30));
    await page.getByTestId("timesheet-extra-note").fill("Set-up before the crew arrived");
    await page.getByTestId("timesheet-extra-send").click();
    await expect(page.getByTestId("timesheet-done")).toContainText(/Extra hours sent/, { timeout: 15_000 });
    const { data: extra } = await db!.from("timesheet_entries").select("source, status, note, break_minutes").eq("contractor_id", employeeCid).eq("note", "Set-up before the crew arrived").single();
    expect((extra as { source: string; status: string; break_minutes: number }).source).toBe("painter");
    expect((extra as { status: string }).status).toBe("submitted");
    expect(await page.locator("body").innerText()).not.toMatch(/\$\s?\d/);
  });

  test("approval refuses a day no cost rate covers, and says so on the row", async ({ page }) => {
    const rec = await rpcAs(staff!, "timesheet_record", {
      p_contractor_id: norateCid, p_work_order_id: fixture!.workOrderId,
      p_started_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), p_finished_at: new Date().toISOString(), p_break_minutes: 0,
    });
    expect(rec).toMatch(/^ok:/);
    const id = rec.slice(3);
    expect(await rpcAs(staff!, "timesheet_approve", { p_entry_id: id })).toBe("error:no_rate");
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc/timesheets");
    await expect(page.getByTestId(`timesheet-norate-${id}`)).toBeVisible();
    // Rejecting works without a rate and carries the reason to the painter.
    expect(await rpcAs(staff!, "timesheet_reject", { p_entry_id: id, p_reason: "Wrong job" })).toBe("ok:rejected");
    const { count } = await db!.from("job_costs").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId).eq("category", "labour");
    expect(count, "a rejected day posts nothing").toBe(1);
    // A contractor never has a cost rate.
    expect(await rpcAs(staff!, "set_employee_cost_rate", { p_contractor_id: crypto.randomUUID(), p_cents_per_hour: 5000 })).toBe("error:not_found");
  });

  test("the painter sees the approved day as hours and a status — never the amount", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    await expect(page.getByTestId(`timesheet-entry-${recordedId}`)).toContainText(/7\.6 h/);
    await expect(page.getByTestId(`timesheet-entry-${recordedId}`)).toContainText("Approved");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\$\s?\d|399|52\.50/);
    // Their job page carries the same card, scoped to the job.
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await expect(page.getByTestId("timesheet-card")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/\$\s?\d|399|52\.50/);
  });
});
