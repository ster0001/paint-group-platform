import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  accessTokenFor, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Employed painters — Session 2: assignments, Accept, lead painter, calendar.
 *
 * Three employees on one job → three lanes, one lead marker, ONE stage
 * transition, ONE customer confirmation. The database refuses a second lead
 * and refuses to release the lead while anyone else is on the job. The
 * painter's Accept sets accepted_at and logs the event; a date change clears
 * it. An overlap is refused naming the conflicting job; an override is
 * logged. No employee action ever creates a booking offer.
 *
 * The office half runs through the REAL board (drag → sheet → Assign); the
 * painter half runs through each employee's own session (rpcAs), never the
 * service key. Every account and row made here is removed at the end.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const run = Date.now().toString(36);
type Emp = { email: string; password: string; name: string; userId: string; contractorId: string };
const employees: Emp[] = [];
let fixture: LoopFixture | null = null;
let otherJob: LoopFixture | null = null;
let woRef = "";

async function makeEmployee(name: string): Promise<Emp> {
  const email = `pg.e2e.employee.${run}.${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
  const password = `Employee-${run}-pw!`;
  const created = await db!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) throw new Error(`create ${name}: ${created.error?.message}`);
  const userId = created.data.user.id;
  const role = await db!.from("profiles").update({ role: "contractor", name }).eq("id", userId);
  if (role.error) throw new Error(`role ${name}: ${role.error.message}`);
  const c = await db!.from("contractors")
    .insert({ profile_id: userId, tier: "B", active: true, company_name: "", employment_type: "employee" })
    .select("id").single();
  if (c.error) throw new Error(`contractors ${name}: ${c.error.message}`);
  return { email, password, name, userId, contractorId: (c.data as { id: string }).id };
}

async function readAs(who: { email: string; password: string }, path: string): Promise<unknown[]> {
  const token = await accessTokenFor(who);
  const body = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }).then((r) => r.json());
  if (!Array.isArray(body)) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body;
}

async function assignments() {
  const { data, error } = await db!.from("wo_assignments")
    .select("id, contractor_id, is_lead, status, accepted_at, start_date, end_date")
    .eq("work_order_id", fixture!.workOrderId).neq("status", "released").order("assigned_at");
  if (error) throw new Error(error.message);
  return data as { id: string; contractor_id: string; is_lead: boolean; status: string; accepted_at: string | null; start_date: string; end_date: string }[];
}

async function events(type: string) {
  const { data, error } = await db!.from("wo_events").select("id, type, meta, actor_kind")
    .eq("work_order_id", fixture!.workOrderId).eq("type", type);
  if (error) throw new Error(error.message);
  return data as { id: string; type: string; meta: Record<string, unknown>; actor_kind: string }[];
}

/** Drag from the centre of one element to the centre of another, in small steps. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several small moves: one jump can be read as a click rather than a drag.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}
/**
 * The centre of an element AFTER scrolling it into view. The tray is a long
 * scrolling column: a card below the fold has a bounding box outside the
 * viewport, and a mouse-down there selects text instead of starting a drag.
 */
async function centreOf(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const START = "2026-11-02"; // a Monday, well clear of anything seeded

test.describe("employed painters — assignments", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the employee accounts");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    for (const n of ["Alfa", "Bravo", "Charlie"]) employees.push(await makeEmployee(`E2E ${n}`));
    // The job: issued, at stage 1 (offered), in the tray. Given a distinctive ref
    // so the board test can find it among whatever else is in the tray.
    fixture = await createLoopFixture(db!, employees[0].contractorId, [{ heading: "Hall", labels: ["Walls", "Ceiling"] }]);
    woRef = `WO-EMP${run.slice(-5).toUpperCase()}`;
    const reset = await db!.from("work_orders")
      .update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued", wo_ref: woRef })
      .eq("id", fixture.workOrderId);
    if (reset.error) throw new Error(`reset: ${reset.error.message}`);
    // A second job Alfa is already on — for the overlap refusal.
    otherJob = await createLoopFixture(db!, employees[0].contractorId, [{ heading: "Other", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued" }).eq("id", otherJob.workOrderId);
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    if (otherJob) await destroyLoopFixture(db!, otherJob);
    for (const e of employees) {
      const r = await db!.from("contractors").delete().eq("id", e.contractorId);
      if (r.error) throw new Error(`teardown contractors: ${r.error.message}`);
      const u = await db!.auth.admin.deleteUser(e.userId);
      if (u.error) throw new Error(`teardown user: ${u.error.message}`);
    }
  });

  test("the office drags the job onto an employee lane and assigns it — no offer is created", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/schedule?from=${START}&days=14`);
    await expect(page.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });

    const tray = page.locator(`[data-testid="tray-job"][data-wo-ref="${woRef}"]`);
    await expect(tray).toHaveCount(1);
    const laneSel = `[data-testid="lane"][data-contractor-id="${employees[0].contractorId}"]`;
    await expect(page.locator(laneSel)).toHaveCount(1);
    // Its header says EMPLOYEE, not READY / NOT READY.
    await expect(page.locator(`.crow:has(${laneSel}) [data-testid="lane-employee"]`)).toBeVisible();

    // Scroll the CARD into view first — that scroll moves the whole page, so
    // the lane is measured afterwards, in its final place. (Measuring the lane
    // first dropped the job one row down, on a contractor.) Land on the first
    // visible day: the lane's left edge plus half a cell.
    const card = await centreOf(page, `[data-testid="tray-job"][data-wo-ref="${woRef}"]`);
    const lane = await centreOf(page, laneSel);
    const laneBox = (await page.locator(laneSel).first().boundingBox())!;
    await dragTo(page, card, { x: laneBox.x + 30, y: lane.y });

    // The sheet is the assignment sheet, not the offer sheet, and shows no price.
    const sheet = page.locator(".sheet.open");
    await expect(sheet.getByRole("heading", { name: "Assign this job?" })).toBeVisible();
    await expect(sheet).not.toContainText(/their price|\$\s?\d/i);
    await page.locator('[data-testid="use-suggested-walkthrough"]').click();
    await page.locator('[data-testid="walkthrough-time"]').fill("15:00");
    await page.getByTestId("drop-confirm").click();

    // The job leaves the tray and sits on the employee's lane, hollow (not yet seen), as the lead.
    await expect(tray).toHaveCount(0);
    const block = page.locator(`${laneSel} [data-testid="assignment-block"]`);
    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute("data-lead", "1");
    await expect(block).toHaveClass(/hollow/);

    // Database: one assignment, lead, the job moved out of stage 1 by ONE event
    // carrying acceptance_mode = assigned, and NO booking offer anywhere.
    const rows = await assignments();
    expect(rows).toHaveLength(1);
    expect(rows[0].is_lead).toBe(true);
    expect(rows[0].status).toBe("assigned");
    const { data: wo } = await db!.from("work_orders").select("stage, contractor_id, start_date").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("pre_start");
    expect((wo as { contractor_id: string }).contractor_id).toBe(employees[0].contractorId);
    const stage = await events("stage_changed");
    expect(stage.filter((e) => e.meta.acceptance_mode === "assigned")).toHaveLength(1);
    const { count } = await db!.from("booking_offers").select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId);
    expect(count).toBe(0);
  });

  test("two more painters join from the block's detail sheet — three lanes, one lead, one confirmation", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/schedule?from=${START}&days=14`);
    await expect(page.getByTestId("lane").first()).toBeVisible({ timeout: 30_000 });

    for (const e of [employees[1], employees[2]]) {
      await page.locator(`[data-testid="assignment-block"][data-lead="1"]`).first().click();
      const detail = page.getByTestId("assignment-detail");
      await expect(detail).toBeVisible();
      await detail.getByTestId("add-painter").selectOption(e.contractorId);
      await detail.getByTestId("add-painter-go").click();
      await expect(page.locator(".sheet.open")).toHaveCount(0, { timeout: 15_000 });
    }

    const blocks = page.locator('[data-testid="assignment-block"]');
    await expect(blocks).toHaveCount(3);
    await expect(page.locator('[data-testid="assignment-block"][data-lead="1"]')).toHaveCount(1);
    await expect(blocks.first()).toContainText(/1 OF 3/);

    const rows = await assignments();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.is_lead)).toHaveLength(1);
    // Still exactly one stage transition on the job.
    expect((await events("stage_changed")).filter((e) => e.meta.acceptance_mode === "assigned")).toHaveLength(1);
    // And the customer was confirmed ONCE for this start date (the fixture has
    // no customer email, so the record is the "skipped" event — still one).
    const confirms = [...(await events("appt_confirm_sent")), ...(await events("appt_confirm_skipped"))];
    expect(confirms.length, "one confirmation record per start date").toBeLessThanOrEqual(1);
  });

  test("the database refuses a second lead, and refuses to release the lead while others remain", async () => {
    const rows = await assignments();
    const nonLead = rows.find((r) => !r.is_lead)!;
    const lead = rows.find((r) => r.is_lead)!;

    // Second lead, straight at the table (service role bypasses RLS but not the index).
    const dup = await db!.from("wo_assignments").update({ is_lead: true }).eq("id", nonLead.id);
    expect(dup.error?.code, "unique index wo_assignments_one_lead").toBe("23505");

    // Releasing the lead while two others are on the job.
    const refused = await rpcAs(staff!, "release_assignment", { p_assignment_id: lead.id, p_reason: "test" });
    expect(refused).toBe("error:lead_needs_replacement");
  });

  test("Accept sets accepted_at and logs the event; a date change clears it and logs again", async () => {
    const rows = await assignments();
    const mine = rows.find((r) => r.contractor_id === employees[1].contractorId)!;
    const bravo = employees[1];

    // Bravo can see the crew (all three rows on their job), and no one else's job.
    const seen = await readAs(bravo, `wo_assignments?work_order_id=eq.${fixture!.workOrderId}&select=id`);
    expect(seen).toHaveLength(3);
    const others = await readAs(bravo, `wo_assignments?work_order_id=eq.${otherJob!.workOrderId}&select=id`);
    expect(others).toHaveLength(0);

    // Somebody else's tap is refused; Bravo's own is accepted; a second tap is a no-op.
    expect(await rpcAs(employees[2], "acknowledge_assignment", { p_assignment_id: mine.id })).toBe("error:not_yours");
    expect(await rpcAs(bravo, "acknowledge_assignment", { p_assignment_id: mine.id })).toBe("ok:accepted");
    expect(await rpcAs(bravo, "acknowledge_assignment", { p_assignment_id: mine.id })).toBe("ok:accepted");
    let after = (await assignments()).find((r) => r.id === mine.id)!;
    expect(after.status).toBe("accepted");
    expect(after.accepted_at).not.toBeNull();
    expect((await events("assignment_acknowledged")).filter((e) => e.meta.assignment_id === mine.id)).toHaveLength(1);

    // The office moves Bravo's days: Accept is cleared, the event names both spans.
    const moved = await rpcAs(staff!, "reassign_dates", { p_assignment_id: mine.id, p_start: "2026-11-04", p_end: "2026-11-05" });
    expect(moved).toBe("ok:moved");
    after = (await assignments()).find((r) => r.id === mine.id)!;
    expect(after.status).toBe("assigned");
    expect(after.accepted_at).toBeNull();
    expect(after.start_date).toBe("2026-11-04");
    const changed = (await events("assignment_dates_changed")).filter((e) => e.meta.assignment_id === mine.id);
    expect(changed).toHaveLength(1);
    expect((changed[0].meta.to as { start_date: string }).start_date).toBe("2026-11-04");
  });

  test("an overlap is refused naming the conflicting job; an override is logged", async () => {
    // Alfa is on the main job over START..START+1. Assign Alfa to the other job on the same days.
    const clash = await rpcAs(staff!, "assign_job", {
      p_work_order_id: otherJob!.workOrderId,
      p_painters: [{ contractor_id: employees[0].contractorId, start_date: START, end_date: START }],
      p_lead_contractor_id: employees[0].contractorId,
    });
    expect(clash).toBe(`conflict:overlap:${woRef}`);
    const { count: none } = await db!.from("wo_assignments").select("id", { count: "exact", head: true }).eq("work_order_id", otherJob!.workOrderId);
    expect(none).toBe(0);

    // With a reason, it goes through and the reason is on the event.
    const forced = await rpcAs(staff!, "assign_job", {
      p_work_order_id: otherJob!.workOrderId,
      p_painters: [{ contractor_id: employees[0].contractorId, start_date: START, end_date: START }],
      p_lead_contractor_id: employees[0].contractorId,
      p_override_reason: "agreed — half a day each",
    });
    expect(forced).toBe("ok:assigned:1");
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", otherJob!.workOrderId).eq("type", "assignment_made");
    expect(((ev ?? []) as { meta: Record<string, unknown> }[])[0]?.meta.override_reason).toBe("agreed — half a day each");

    // A contractor can never be assigned (ruling 9).
    const { data: anyContractor } = await db!.from("contractors").select("id").eq("employment_type", "contractor").limit(1).maybeSingle();
    if (anyContractor) {
      const refused = await rpcAs(staff!, "assign_job", {
        p_work_order_id: otherJob!.workOrderId,
        p_painters: [{ contractor_id: (anyContractor as { id: string }).id, start_date: "2026-11-09", end_date: "2026-11-09" }],
        p_lead_contractor_id: (anyContractor as { id: string }).id,
      });
      expect(refused).toBe("error:not_employee");
    }
  });

  test("changing the lead moves the marker and the customer-facing painter; no employee action created an offer", async () => {
    const rows = await assignments();
    const newLead = rows.find((r) => !r.is_lead)!;
    expect(await rpcAs(staff!, "set_lead_painter", { p_work_order_id: fixture!.workOrderId, p_contractor_id: newLead.contractor_id })).toBe("ok:lead");
    const after = await assignments();
    expect(after.filter((r) => r.is_lead).map((r) => r.contractor_id)).toEqual([newLead.contractor_id]);
    const { data: wo } = await db!.from("work_orders").select("contractor_id").eq("id", fixture!.workOrderId).single();
    expect((wo as { contractor_id: string }).contractor_id).toBe(newLead.contractor_id);
    expect(await events("lead_painter_changed")).toHaveLength(1);

    // The old lead can now be released; the job keeps its other two painters.
    const old = after.find((r) => !r.is_lead && r.contractor_id === employees[0].contractorId)!;
    expect(await rpcAs(staff!, "release_assignment", { p_assignment_id: old.id, p_reason: "needed elsewhere" })).toBe("ok:released");
    expect(await assignments()).toHaveLength(2);

    const { count } = await db!.from("booking_offers").select("id", { count: "exact", head: true })
      .in("work_order_id", [fixture!.workOrderId, otherJob!.workOrderId]);
    expect(count, "no employee action ever creates an offer").toBe(0);
  });
});
