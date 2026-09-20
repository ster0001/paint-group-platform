import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * The pre-start list is the SAME on an employee's job as on a contractor's
 * (Tom, 18 Sep: "in PC command the pre-start checklist has been removed from
 * employees — this still needs to happen for both").
 *
 * Why this spec did not exist, and why the hole was invisible: the employee
 * loop reaches pre-start through `completePreStart`, which walks whatever rows
 * it finds. On a job with NO list it finds none, ticks nothing, returns
 * happily — and `wo_gate_blocked` then counts zero unticked required items and
 * lets the job start. An empty list and a finished list were the same thing to
 * every test we had. So this asserts on the OFFICE'S SCREEN that the list is
 * there, and on the gate that a job without one cannot start.
 *
 * Both painters are exercised: one job assigned to an employee, one offered to
 * a contractor, same assertions — the point is that they are identical.
 *
 * Everything made here is removed in afterAll.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const employee = { email: `pg.e2e.prestart.${run}.emp@example.com`, password: `Prestart-${run}-pw!` };
const REQUIRED_LABELS = [
  "Colour schedule finalised",
  "Materials ordered",
  "Equipment movements booked",
  "Access details recorded",
];

let userId: string | null = null;
let employeeCid: string | null = null;
let assigned: LoopFixture | null = null;
let offered: LoopFixture | null = null;

/** Put a fixture job back to stage 1, unassigned, with no list of any kind. */
async function backToStageOne(workOrderId: string) {
  const reset = await db!.from("work_orders").update({
    contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued",
  }).eq("id", workOrderId);
  if (reset.error) throw new Error(reset.error.message);
  const wiped = await db!.from("wo_checklist_items").delete().eq("work_order_id", workOrderId);
  if (wiped.error) throw new Error(wiped.error.message);
}

test.describe("the pre-start list — the same on an employee's job as a contractor's", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the employee account");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const created = await db!.auth.admin.createUser({
      email: employee.email, password: employee.password, email_confirm: true,
      user_metadata: { name: "E2E Pre-start Employee" },
    });
    if (created.error || !created.data.user) throw new Error(`create employee: ${created.error?.message}`);
    userId = created.data.user.id;
    const role = await db!.from("profiles").update({ role: "contractor", name: "E2E Pre-start Employee" }).eq("id", userId);
    if (role.error) throw new Error(role.error.message);
    const c = await db!.from("contractors")
      .insert({ profile_id: userId, tier: "B", active: true, company_name: "", employment_type: "employee" })
      .select("id").single();
    if (c.error) throw new Error(c.error.message);
    employeeCid = (c.data as { id: string }).id;

    assigned = await createLoopFixture(db!, employeeCid, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }]);
    offered = await createLoopFixture(db!, employeeCid, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }]);
    await backToStageOne(assigned.workOrderId);
    await backToStageOne(offered.workOrderId);
  });

  test.afterAll(async () => {
    if (assigned) await destroyLoopFixture(db!, assigned);
    if (offered) await destroyLoopFixture(db!, offered);
    if (employeeCid) {
      await db!.from("wo_assignments").delete().eq("contractor_id", employeeCid);
      const r = await db!.from("contractors").delete().eq("id", employeeCid);
      if (r.error) throw new Error(`teardown contractor: ${r.error.message}`);
    }
    if (userId) {
      const r = await db!.auth.admin.deleteUser(userId);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("assigning an employee builds the pre-start list, and the office sees it on the job", async ({ page }) => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    const r = await rpcAs(staff!, "assign_job", {
      p_work_order_id: assigned!.workOrderId,
      p_painters: [{ contractor_id: employeeCid, start_date: today, end_date: today }],
      p_lead_contractor_id: employeeCid,
    });
    expect(r, "assign_job").toMatch(/^ok:/);

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", assigned!.workOrderId).single();
    expect((wo as { stage: string }).stage, "the first assignment moves the job to pre-start").toBe("pre_start");

    // The rows exist — an employee is assigned, never offered, and that must
    // not cost the job its list.
    const { data: items, error } = await db!.from("wo_checklist_items")
      .select("label, required").eq("work_order_id", assigned!.workOrderId).eq("phase", "pre_start");
    expect(error, "reading the list").toBeNull();
    const labels = ((items ?? []) as { label: string }[]).map((i) => i.label);
    for (const label of REQUIRED_LABELS) expect(labels, `employee job is missing "${label}"`).toContain(label);

    // …and the office actually sees them on the job page.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${assigned!.workOrderId}`);
    await expect(page.getByTestId("pre-start-missing")).toHaveCount(0);
    const body = page.locator("body");
    await expect(body).toContainText("Pre-start");
    for (const label of REQUIRED_LABELS) await expect(body).toContainText(label);
  });

  test("the job that got there the offered way carries an identical list", async ({ page }) => {
    // The other route into pre-start — the one a contractor's acceptance takes.
    // The list is a property of the JOB, not of who is painting it, so the two
    // lists must be the same list.
    const moved = await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: offered!.workOrderId, p_to: "pre_start" });
    expect(moved).toBe("ok:pre_start");

    const labelsFor = async (workOrderId: string) => {
      const { data, error } = await db!.from("wo_checklist_items")
        .select("label").eq("work_order_id", workOrderId).eq("phase", "pre_start");
      expect(error).toBeNull();
      return ((data ?? []) as { label: string }[]).map((i) => i.label).sort();
    };
    expect(await labelsFor(offered!.workOrderId)).toEqual(await labelsFor(assigned!.workOrderId));

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${offered!.workOrderId}`);
    await expect(page.getByTestId("pre-start-missing")).toHaveCount(0);
    const body = page.locator("body");
    for (const label of REQUIRED_LABELS) await expect(body).toContainText(label);
  });

  test("a job with no list at all cannot start — an empty list is not a finished one", async () => {
    // Strip the list off the employee's job behind the app's back: this is the
    // state jobs were reaching in the wild, and the state that used to start.
    const wiped = await db!.from("wo_checklist_items").delete().eq("work_order_id", assigned!.workOrderId);
    expect(wiped.error).toBeNull();

    const refused = await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: assigned!.workOrderId, p_to: "in_progress",
    });
    expect(refused, "a listless job must not walk into In progress").toMatch(/^error:gate:/);
    expect(refused).toContain("pre-start list has not been built");

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", assigned!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("pre_start");
  });

  test("the office opening the job builds the missing list, and then it starts", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${assigned!.workOrderId}`);
    await expect(page.getByTestId("pre-start-missing")).toHaveCount(0);
    for (const label of REQUIRED_LABELS) await expect(page.locator("body")).toContainText(label);

    // The heal is real rows, not a drawing.
    const { data: items } = await db!.from("wo_checklist_items")
      .select("id, auto_key, required, kind").eq("work_order_id", assigned!.workOrderId).eq("phase", "pre_start");
    const rows = (items ?? []) as { id: string; auto_key: string | null; required: boolean; kind: string | null }[];
    expect(rows.length, "the page seeds on view").toBeGreaterThan(0);

    // With the list built and ticked, the job starts exactly as before.
    await db!.from("work_orders").update({
      colours: { Weathershield: { name: "Vivid White", hex: "#fff", status: "confirmed" } },
    }).eq("id", assigned!.workOrderId);
    for (const i of rows) {
      if (i.auto_key || !i.required) continue;
      if (i.kind === "yes_no") {
        expect(await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: i.id, p_answer: "yes", p_note: "" })).toMatch(/^ok:/);
      } else {
        expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: i.id, p_done: true })).toMatch(/^ok:/);
      }
    }
    expect(await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: assigned!.workOrderId, p_to: "in_progress",
    })).toBe("ok:in_progress");
  });
});
