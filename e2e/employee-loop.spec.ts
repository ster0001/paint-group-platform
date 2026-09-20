import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, drawSignature, missingCreds, signIn } from "./helpers";
import {
  completePreStart, completePrep, createLoopFixture, customerIdForEmail, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS } from "../lib/painters/money";

/**
 * Employed painters — Session 7: the whole loop in the employee role, plus
 * the attention items, the leave flow and the switch (brief §6 Session 7).
 *
 *  assigned → Accept → pre-start → ticks by TWO painters → a variation the
 *  customer signs (applied, employees told in hours) → QA → walkthrough on
 *  the lead's device → signed → closed. Then: the day's hours approved onto
 *  the job; an RDO asked for, seen on Today, approved; a sick day raising
 *  Reassign; the unaccepted-assignment item appearing and clearing from
 *  model state only; the office's switch.
 *
 * Every account and row made here is removed at the end.
 */

const staff = credentials("STAFF");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const lead = { email: `pg.e2e.employee.${run}.lead@example.com`, password: `Employee-${run}-pw!` };
const crew = { email: `pg.e2e.employee.${run}.crew@example.com`, password: `Employee-${run}-pw!` };
const LEAD_NAME = "E2E Lead Employee";
const CREW_NAME = "E2E Crew Employee";
const ids: { user: string; contractor: string }[] = [];
let fixture: LoopFixture | null = null;
let leadCid = "";
let crewCid = "";
let crewAssignmentId = "";
let variationId = "";
let signoffToken = "";
let rdoId = "";

const melbourneDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const shift = (day: string, n: number) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const today = melbourneDay(new Date());

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

const photoFor = async (kind: string, area = "") => {
  const { error } = await db!.from("wo_photos").insert({
    work_order_id: fixture!.workOrderId, kind, area,
    storage_path: `wo/${fixture!.workOrderId}/${kind}-${Math.random().toString(36).slice(2)}.jpg`,
  });
  if (error) throw new Error(error.message);
};

/** Walk the office's Today queue (50 a page, Overdue first) for a card matching `re`. */
async function onToday(page: Page, filter: "followups" | "approvals", re: RegExp): Promise<boolean> {
  for (let p = 1; p <= 12; p++) {
    await page.goto(`/crm/today?f=${filter}&who=all&page=${p}`);
    await expect(page.getByTestId("who-chips")).toBeVisible({ timeout: 30_000 });
    if (await page.locator(`text=${re}`).count()) return true;
    if (!(await page.getByRole("link", { name: /older/i }).count())) return false;
  }
  return false;
}

test.describe("employed painters — the whole loop, then Session 7", () => {
  test.skip(!staff || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the accounts");
  // Three of these walk the office's Today queue page by page (50 a page, many pages on the test project).
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async () => {
    const flag = await db!.from("settings").upsert({ key: "employees_enabled", value: { enabled: true } }, { onConflict: "key" });
    if (flag.error) throw new Error(flag.error.message);
    leadCid = await makePainter(lead, LEAD_NAME);
    crewCid = await makePainter(crew, CREW_NAME);
    const customerId = await customerIdForEmail(db!, customer!.email);
    fixture = await createLoopFixture(db!, leadCid, [
      { heading: "Front", labels: ["Walls — weatherboard", "Windows × 3"] },
      { heading: "Left", labels: ["Eaves — 9 m"] },
    ], customerId);
    await db!.from("work_orders").update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" }).eq("id", fixture.workOrderId);
    await db!.from("estimates").update({ total_cents: 1_842_000, accepted_name: "Melissa Hartley" }).eq("id", fixture.estimateId);
    const r = await rpcAs(staff!, "assign_job", {
      p_work_order_id: fixture.workOrderId,
      p_painters: [
        { contractor_id: leadCid, start_date: today, end_date: shift(today, 1) },
        { contractor_id: crewCid, start_date: today, end_date: shift(today, 1) },
      ],
      p_lead_contractor_id: leadCid,
    });
    if (!r.startsWith("ok:")) throw new Error(`assign_job: ${r}`);
    const { data: a } = await db!.from("wo_assignments").select("id").eq("work_order_id", fixture.workOrderId).eq("contractor_id", crewCid).single();
    crewAssignmentId = (a as { id: string }).id;
    const rate = await rpcAs(staff!, "set_employee_cost_rate", { p_contractor_id: leadCid, p_cents_per_hour: 5000, p_effective_from: "2026-01-01" });
    if (!rate.startsWith("ok:")) throw new Error(`set_employee_cost_rate: ${rate}`);
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    for (const { contractor } of ids) {
      await db!.from("contractor_unavailability").delete().eq("contractor_id", contractor);
      const r = await db!.from("contractors").delete().eq("id", contractor);
      if (r.error) throw new Error(`teardown contractors: ${r.error.message}`);
    }
    for (const { user } of ids) {
      const r = await db!.auth.admin.deleteUser(user);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
    // Leave the switch on for the test project (every employee spec relies on it).
    await db!.from("settings").upsert({ key: "employees_enabled", value: { enabled: true } }, { onConflict: "key" });
  });

  test("1 · assigned, not offered: the lead taps Accept; the crew's silence is an item that clears from model state", async ({ page, browser }) => {
    const { data: wo } = await db!.from("work_orders").select("stage, contractor_id").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("pre_start");        // the first assign_job moved it
    expect((wo as { contractor_id: string }).contractor_id).toBe(leadCid); // the lead IS contractor_id
    const { count: offers } = await db!.from("booking_offers").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId);
    expect(offers, "an employee is never offered").toBe(0);

    await signIn(page, lead, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await page.getByTestId("accept-assignment").click();
    await expect(page.getByTestId("assignment-accepted")).toBeVisible({ timeout: 15_000 });

    // The crew painter hasn't tapped, and the job starts today → "Not accepted", a Call painter item.
    const office = await browser.newContext();
    const staffPage = await office.newPage();
    await signIn(staffPage, staff!, /\/(home|estimates)/);
    expect(await onToday(staffPage, "followups", new RegExp(`${CREW_NAME} hasn't accepted`))).toBe(true);
    // They tap — nothing is stored or dismissed; the item is simply gone.
    expect(await rpcAs(crew, "acknowledge_assignment", { p_assignment_id: crewAssignmentId })).toMatch(/^ok:/);
    expect(await onToday(staffPage, "followups", new RegExp(`${CREW_NAME} hasn't accepted`))).toBe(false);
    await office.close();
  });

  test("2 · the office works the pre-start list; the job goes live", async () => {
    await db!.from("work_orders").update({
      colours: { Weathershield: { name: "Vivid White", hex: "#fff", status: "confirmed" } },
    }).eq("id", fixture!.workOrderId);
    await completePreStart(db!, staff!, fixture!.workOrderId);
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fixture!.workOrderId, p_to: "in_progress" })).toBe("ok:in_progress");
  });

  test("3 · both painters tick — the non-lead too (the crew rule)", async () => {
    const { data: surfaces } = await db!.from("wo_surfaces").select("id, heading").eq("work_order_id", fixture!.workOrderId).order("sort");
    const rows = surfaces as { id: string; heading: string }[];
    for (const h of ["Front", "Left"]) { await photoFor("before", h); await photoFor("completion", h); }
    // The crew painter ticks the first; the lead the rest.
    expect(await rpcAs(crew, "wo_tick_surface", { p_surface_id: rows[0].id, p_to: "done" })).toBe("ok:done");
    for (const s of rows.slice(1)) expect(await rpcAs(lead, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" })).toBe("ok:done");
    const { data: done } = await db!.from("wo_surfaces").select("id").eq("work_order_id", fixture!.workOrderId).eq("state", "done");
    expect((done ?? []).length).toBe(rows.length);
  });

  test("4 · the crew painter raises a variation; the customer signs; it applies itself and every employee is told in hours", async ({ page }) => {
    await photoFor("variation");
    const { data: ph } = await db!.from("wo_photos").select("id").eq("work_order_id", fixture!.workOrderId).eq("kind", "variation").limit(1).single();
    const raised = await rpcAs(crew, "wo_raise_variation", {
      p_work_order_id: fixture!.workOrderId, p_category: "rot",
      p_comment: "Three lower boards on the left are soft right through — E2E loop.",
      p_photo_ids: [(ph as { id: string }).id], p_est_hours: 3,
    });
    expect(raised).toMatch(/^ok:/);
    variationId = raised.slice(3);
    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: variationId, p_price_cents: 84_000, p_inputs: { hours: 3 },
      p_priced_lines: [{ label: "Replace three lower weatherboards", cents: 84_000 }], p_hours: 3,
    });
    expect(priced).toMatch(/^ok:/);

    // Through the PAGE, so the after() hooks fire — that is where the employee text is sent from.
    await page.goto(`/v/${priced.slice(3)}`);
    await page.getByTestId("approve-variation").click();
    await page.getByTestId("sign-name").fill("Melissa Hartley");
    await page.getByTestId("signature-canvas").scrollIntoViewIfNeeded();
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved", { timeout: 20_000 });

    const { data: v } = await db!.from("wo_variations").select("status").eq("id", variationId).single();
    expect((v as { status: string }).status).toBe("contractor_accepted"); // the trigger, no accept step
    // Both employees on the job get the employee wording — recorded once each, whether or not a phone exists.
    await expect.poll(async () => {
      const { count } = await db!.from("wo_events").select("id", { count: "exact", head: true })
        .eq("work_order_id", fixture!.workOrderId).eq("type", "employee_variation_notified");
      return count ?? 0;
    }, { timeout: 20_000 }).toBe(2);
  });

  test("5 · prep, quality check, then the walkthrough on the lead's device — signed, closed, the report names the lead", async ({ page }) => {
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fixture!.workOrderId, p_to: "completion_prep" })).toBe("ok:completion_prep");
    await completePrep(db!, staff!, fixture!.workOrderId);
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fixture!.workOrderId, p_to: "qa" })).toBe("ok:qa");
    const { data: check } = await db!.from("wo_qa_checks").insert({ work_order_id: fixture!.workOrderId, kind: "final" }).select("id").single();
    for (let i = 0; i < 3; i++) await photoFor("qa");
    const { data: qaItems } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", (check as { id: string }).id);
    for (const item of (qaItems ?? []) as { id: string }[]) await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
    // The last pass routes the job on by itself (20261104) — or, with a sibling
    // cadence check still open, reads as a plain pass and the office delivers.
    const passed = await rpcAs(staff!, "wo_record_qa", { p_check_id: (check as { id: string }).id, p_result: "pass", p_notes: "All good.", p_rectify: [] });
    expect(passed).toMatch(/^ok:pass/);
    if (!passed.startsWith("ok:pass:walkthrough")) {
      await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", fixture!.workOrderId).is("result", null);
      expect(await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: fixture!.workOrderId })).toMatch(/^ok:/);
    }
    const { data: so } = await db!.from("wo_signoff").select("customer_token").eq("work_order_id", fixture!.workOrderId).single();
    signoffToken = (so as { customer_token: string }).customer_token;
    const { data: atWt } = await db!.from("work_orders").select("stage").eq("id", fixture!.workOrderId).single();
    expect((atWt as { stage: string }).stage).toBe("walkthrough");

    // Mode A: the lead opens the walkthrough from their job page and hands the phone over.
    await signIn(page, lead, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const bar = page.getByTestId("walkthrough-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await bar.getByTestId("walkthrough-bar-start").click();
    await expect(page).toHaveURL(/\/s\//, { timeout: 20_000 });
    await page.getByTestId("approve-Front").click();
    await page.getByTestId("approve-Left").click();
    await page.getByTestId("sign-name").fill("Melissa Hartley");
    await page.getByTestId("sign").click();
    await expect(page.getByTestId("signed")).toContainText("Signed off", { timeout: 20_000 });

    const { data: wo } = await db!.from("work_orders").select("stage, status").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("closed");
    expect((wo as { status: string }).status).toBe("complete");
    // No contractor invoice for anyone: employees are paid through payroll.
    const { count: ci } = await db!.from("contractor_invoices").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId);
    expect(ci).toBe(0);
    // The customer's report names the lead only.
    await page.goto(`/s/${signoffToken}`);
    await expect(page.getByTestId("report-lead-painter")).toContainText("Your painter: E2E");
    await expect(page.getByTestId("completion-report")).not.toContainText(CREW_NAME);
  });

  test("6 · the lead's day is approved onto the job, and the office is nudged once it has waited a day", async ({ page }) => {
    const rec = await rpcAs(staff!, "timesheet_record", {
      p_contractor_id: leadCid, p_work_order_id: fixture!.workOrderId,
      p_started_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), p_finished_at: new Date(Date.now() - 26 * 3_600_000).toISOString(), p_break_minutes: 0,
    });
    expect(rec).toMatch(/^ok:/);
    await signIn(page, staff!, /\/(home|estimates)/);
    expect(await onToday(page, "approvals", new RegExp(`1 clocked day from ${LEAD_NAME} waiting on approval`))).toBe(true);
    expect(await rpcAs(staff!, "timesheet_approve", { p_entry_id: rec.slice(3) })).toMatch(/^ok:/);
    expect(await onToday(page, "approvals", new RegExp(`clocked day from ${LEAD_NAME}`))).toBe(false);
    const { data: costs } = await db!.from("job_costs").select("amount_ex_cents").eq("work_order_id", fixture!.workOrderId).eq("category", "labour");
    expect((costs as { amount_ex_cents: number }[]).map((c) => c.amount_ex_cents)).toEqual([20_000]); // 4 h × $50
  });

  test("7 · an RDO is asked for from the calendar, sits on Today, is approved from PC Command, and blocks the board", async ({ page, browser }) => {
    const from = shift(today, 10);
    await signIn(page, crew, /\/portal/);
    await page.goto("/portal/calendar");
    await expect(page.getByTestId("time-off-card")).toBeVisible();
    await page.getByTestId("time-off-kind-rdo").click();
    await page.getByTestId("time-off-start").fill(from);
    await page.getByTestId("time-off-end").fill(from);
    await page.getByTestId("time-off-reason").fill("Long weekend — E2E");
    await page.getByTestId("time-off-send").click();
    await expect(page.getByTestId("time-off-done")).toContainText(/Sent to the office/, { timeout: 15_000 });
    const { data: req } = await db!.from("contractor_unavailability").select("id, kind, approved_at").eq("contractor_id", crewCid).eq("kind", "rdo").single();
    rdoId = (req as { id: string }).id;
    expect((req as { approved_at: string | null }).approved_at).toBeNull();
    await expect(page.getByTestId(`time-off-${rdoId}`)).toContainText("Requested");
    const html = await page.content();
    for (const key of KNOWN_MONEY_KEYS) expect(html, `leaked ${key}`).not.toContain(key);

    // Not yet approved: the board would still take a booking on that day.
    // (wo_assignment_conflict reads approved_at — pinned in the S2 spec; here we prove the flip.)
    const office = await browser.newContext();
    const staffPage = await office.newPage();
    await signIn(staffPage, staff!, /\/(home|estimates)/);
    expect(await onToday(staffPage, "approvals", new RegExp(`${CREW_NAME} asked for an RDO`))).toBe(true);
    await staffPage.goto("/pc/timesheets");
    await expect(staffPage.getByTestId(`leave-${rdoId}`)).toContainText("Long weekend");
    await staffPage.getByTestId(`leave-approve-${rdoId}`).click();
    await expect(staffPage.getByTestId(`leave-approved-${rdoId}`)).toBeVisible({ timeout: 15_000 });
    expect(await onToday(staffPage, "approvals", new RegExp(`${CREW_NAME} asked for an RDO`))).toBe(false);
    await office.close();

    // Approved: the painter sees it, and the board refuses to schedule over it.
    await page.reload();
    await expect(page.getByTestId(`time-off-${rdoId}`)).toContainText("Approved");
    // A second job through the same fixture builder (its teardown knows every table).
    const clashJob = await createLoopFixture(db!, crewCid, [{ heading: "Hall", labels: ["Walls"] }]);
    try {
      await db!.from("work_orders").update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" }).eq("id", clashJob.workOrderId);
      const clash = await rpcAs(staff!, "assign_job", {
        p_work_order_id: clashJob.workOrderId,
        p_painters: [{ contractor_id: crewCid, start_date: from, end_date: from }], p_lead_contractor_id: crewCid,
      });
      expect(clash).toMatch(/^conflict:unavailable:rdo:/);
    } finally {
      await destroyLoopFixture(db!, clashJob);
    }
  });

  test("8 · a sick day counts at once and raises Reassign on the day it lands on", async ({ page }) => {
    // The loop job is closed — a fresh job today for the crew painter, through the fixture builder.
    // Their days on the closed job still overlap today, so that assignment comes off first.
    const gone = await db!.from("wo_assignments").delete().eq("id", crewAssignmentId);
    if (gone.error) throw new Error(gone.error.message);
    const sickJob = await createLoopFixture(db!, crewCid, [{ heading: "Hall", labels: ["Walls"] }]);
    try {
      await db!.from("work_orders").update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" }).eq("id", sickJob.workOrderId);
      expect(await rpcAs(staff!, "assign_job", {
        p_work_order_id: sickJob.workOrderId, p_painters: [{ contractor_id: crewCid, start_date: today, end_date: today }], p_lead_contractor_id: crewCid,
      })).toMatch(/^ok:/);

      await signIn(page, crew, /\/portal/);
      await page.goto("/portal/calendar");
      await page.getByTestId("time-off-kind-sick").click();
      await page.getByTestId("time-off-send").click();
      await expect(page.getByTestId("time-off-done")).toContainText(/Marked sick for today/, { timeout: 15_000 });

      const { count } = await db!.from("wo_events").select("id", { count: "exact", head: true }).eq("work_order_id", sickJob.workOrderId).eq("type", "assignment_cant_make_it");
      expect(count, "the Reassign item's source event").toBe(1);
      // Sick never waits on approval; a second request over the same day is refused.
      const { data: sick } = await db!.from("contractor_unavailability").select("id").eq("contractor_id", crewCid).eq("kind", "sick");
      expect((sick ?? []).length).toBe(1);
      expect(await rpcAs(crew, "leave_request", { p_kind: "leave", p_start: today, p_end: today, p_reason: "" })).toBe("error:overlap");
      // S7b: the office can mark time off on the painter's behalf — leave is approved at once by the office's hand.
      const byOffice = await rpcAs(staff!, "leave_record_for", { p_contractor_id: crewCid, p_kind: "leave", p_start: shift(today, 30), p_end: shift(today, 31), p_reason: "Office-entered" });
      expect(byOffice).toMatch(/^ok:/);
      const { data: off } = await db!.from("contractor_unavailability").select("approved_at, source").eq("id", byOffice.slice(3)).single();
      expect((off as { approved_at: string | null }).approved_at).not.toBeNull();
      expect((off as { source: string }).source).toBe("staff");
    } finally {
      await destroyLoopFixture(db!, sickJob);
    }
  });

  test("9 · the switch on the Contractors page turns the tick boxes off and on", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contractors");
    const flag = page.getByTestId("employees-enabled");
    await expect(flag).toBeChecked();
    await expect(page.getByTestId(`employee-${leadCid}`)).toBeVisible();
    await flag.click();
    await expect(page.locator("body")).toContainText(/switched off/, { timeout: 15_000 });
    await expect(page.getByTestId(`employee-${leadCid}`)).toHaveCount(0, { timeout: 15_000 });
    const { data: off } = await db!.from("settings").select("value").eq("key", "employees_enabled").single();
    expect((off as { value: { enabled: boolean } }).value.enabled).toBe(false);
    await page.getByTestId("employees-enabled").click();
    await expect(page.locator("body")).toContainText(/switched on/, { timeout: 15_000 });
    await expect(page.getByTestId(`employee-${leadCid}`)).toBeVisible({ timeout: 15_000 });
  });

  test("10 · every stage is reconstructable from the events, in the employee order", async () => {
    const { data } = await db!.from("wo_events").select("from_stage, to_stage").eq("work_order_id", fixture!.workOrderId)
      .eq("type", "stage_changed").order("created_at", { ascending: true });
    const moves = (data as { from_stage: string; to_stage: string }[]).map((e) => `${e.from_stage}>${e.to_stage}`);
    expect(moves[0]).toBe("offered>pre_start");
    expect(moves).toContain("pre_start>in_progress");
    expect(moves).toContain("in_progress>completion_prep");
    expect(moves).toContain("completion_prep>qa");
    expect(moves).toContain("qa>walkthrough");
    expect(moves[moves.length - 1]).toBe("walkthrough>closed");
  });
});
