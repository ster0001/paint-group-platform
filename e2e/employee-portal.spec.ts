import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePreStart, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";
import { KNOWN_MONEY_KEYS } from "../lib/painters/money";

/**
 * Employed painters — Session 3: the employee's own portal.
 *
 * As a real employee: the assigned job is on the list with "Tap Accept" and a
 * time budget (no price); opening it shows the Accept card; Accept stamps
 * accepted_at; the work order opens with an "Assigned" stage badge and no
 * payment section; the job starts; a surface ticks after its before-photo,
 * and the PC's daily update draft names the tick with the employee as actor.
 * "Can't make it" raises the Reassign item on the office's Today queue and
 * leaves the assignment exactly as it was. And on every screen rendered along
 * the way: no dollar figure, no "AUD", no "/hr", no money key.
 *
 * The office half (assign) runs through the RPC as staff — the board itself
 * is proven by employee-assign.spec.ts. Everything made here is removed.
 */

const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const employee = { email: `pg.e2e.employee.${run}.portal@example.com`, password: `Employee-${run}-pw!` };
let userId: string | null = null;
let contractorId: string | null = null;
let fixture: LoopFixture | null = null;
let assignmentId = "";
const START = "2026-11-16";

async function assertNoMoney(html: string, text: string, where: string) {
  for (const key of KNOWN_MONEY_KEYS) expect(html, `${where} leaked ${key}`).not.toContain(key);
  expect(text, `${where} renders a dollar figure`).not.toMatch(/\$\s?\d/);
  expect(text, `${where} says AUD`).not.toMatch(/\bAUD\b/);
  expect(text, `${where} mentions a rate`).not.toMatch(/\/\s?hr\b|per hour/i);
  expect(text, `${where} mentions their price`).not.toMatch(/your price|contractor payment/i);
}

test.describe("employed painter — the portal", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the employee account");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const created = await db!.auth.admin.createUser({ email: employee.email, password: employee.password, email_confirm: true, user_metadata: { name: "E2E Portal Employee" } });
    if (created.error || !created.data.user) throw new Error(`create employee: ${created.error?.message}`);
    userId = created.data.user.id;
    const role = await db!.from("profiles").update({ role: "contractor", name: "E2E Portal Employee" }).eq("id", userId);
    if (role.error) throw new Error(role.error.message);
    const c = await db!.from("contractors").insert({ profile_id: userId, tier: "B", active: true, company_name: "", employment_type: "employee" }).select("id").single();
    if (c.error) throw new Error(c.error.message);
    contractorId = (c.data as { id: string }).id;

    // The job: issued at stage 1, carrying a payment so the strip has something to strip.
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }, { heading: "Hall", labels: ["Doors"] }]);
    const snap = (await db!.from("work_orders").select("wo_snapshot").eq("id", fixture.workOrderId).single()).data as { wo_snapshot: Record<string, unknown> };
    const reset = await db!.from("work_orders").update({
      contractor_id: null, start_date: null, end_date: null, stage: "offered", status: "issued",
      contractor_payment_cents: 123_456,
      wo_snapshot: { ...snap.wo_snapshot, contractorPaymentCents: 123_456, jobTitle: "E2E employee job", jobAddress: "9 Test Lane, Preston VIC 3072" },
    }).eq("id", fixture.workOrderId);
    if (reset.error) throw new Error(reset.error.message);

    // Assigned by the office (the board is proven elsewhere).
    const r = await rpcAs(staff!, "assign_job", {
      p_work_order_id: fixture.workOrderId,
      p_painters: [{ contractor_id: contractorId, start_date: START, end_date: "2026-11-18" }],
      p_lead_contractor_id: contractorId,
    });
    if (!r.startsWith("ok:")) throw new Error(`assign_job: ${r}`);
    const { data: a } = await db!.from("wo_assignments").select("id").eq("work_order_id", fixture.workOrderId).single();
    assignmentId = (a as { id: string }).id;
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    if (contractorId) { const r = await db!.from("contractors").delete().eq("id", contractorId); if (r.error) throw new Error(r.error.message); }
    if (userId) { const r = await db!.auth.admin.deleteUser(userId); if (r.error) throw new Error(r.error.message); }
  });

  test("the job is on the list with Tap Accept and a time budget, and on the calendar", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    for (const path of ["/portal", "/portal/jobs", "/portal/calendar"]) {
      const res = await page.goto(path);
      await assertNoMoney((await res?.text()) ?? "", await page.locator("body").innerText(), path);
    }
    await page.goto("/portal/jobs");
    await expect(page.getByTestId("job-tap-accept")).toBeVisible();
    await expect(page.locator("body")).toContainText(/time budget/i);
    await expect(page.locator("body")).toContainText(/3 DAYS · 3\.0 H/);
    await expect(page.locator("body")).toContainText("E2E employee job");
  });

  test("Accept stamps accepted_at and logs the event; the work order shows Assigned and no payment", async ({ page }) => {
    await signIn(page, employee, /\/portal/);
    const res = await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await assertNoMoney((await res?.text()) ?? "", await page.locator("body").innerText(), "job page");

    const card = page.getByTestId("assignment-card");
    await expect(card).toHaveAttribute("data-accepted", "0");
    await expect(page.getByTestId("time-budget")).toContainText("3 DAYS · 3.0 H");
    await expect(page.locator("body")).toContainText("9 Test Lane"); // assigned = committed, full address
    await expect(page.locator("body")).not.toContainText(/decline|expires in/i);
    await page.getByTestId("accept-assignment").click();
    await expect(page.getByTestId("assignment-accepted")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("assignment-card")).toHaveAttribute("data-accepted", "1");

    const { data: a } = await db!.from("wo_assignments").select("status, accepted_at").eq("id", assignmentId).single();
    expect((a as { status: string }).status).toBe("accepted");
    expect((a as { accepted_at: string | null }).accepted_at).not.toBeNull();
    const { count } = await db!.from("wo_events").select("id", { count: "exact", head: true })
      .eq("work_order_id", fixture!.workOrderId).eq("type", "assignment_acknowledged");
    expect(count).toBe(1);

    // The job sheet carries no payment section for an employee (variant="employee").
    await expect(page.locator("body")).not.toContainText(/Contractor payment/i);
    await expect(page.locator(".wo")).toBeVisible();
  });

  test("the job starts, a surface ticks after its before-photo, and the PC's draft names the employee's tick", async ({ page }) => {
    await completePreStart(db!, staff!, fixture!.workOrderId);
    await signIn(page, employee, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await page.getByTestId("start-job-button").click();
    await expect(page.getByTestId("tick-list")).toBeVisible({ timeout: 20_000 });

    // Before-photo gate, then the tick — the same rule as a contractor's job.
    const lounge = fixture!.surfaces.find((s) => s.heading === "Lounge")!;
    await expect(page.getByTestId("photo-prompt-Lounge")).toBeVisible();
    await db!.from("wo_photos").insert({ work_order_id: fixture!.workOrderId, kind: "before", area: "Lounge", storage_path: `wo/${fixture!.workOrderId}/e2e-before.jpg` });
    await page.reload();
    const row = page.getByTestId(`tick-${lounge.id}`);
    await row.click();
    await expect(row).toContainText("Prepped");
    await row.click();
    await expect(row).toContainText("Done");
    await assertNoMoney((await page.content()), await page.locator("body").innerText(), "job page in progress");

    // The tick is the employee's, and the office's daily draft is built from it.
    const { data: ticks } = await db!.from("wo_events").select("actor, actor_kind, meta")
      .eq("work_order_id", fixture!.workOrderId).eq("type", "surface_tick");
    expect(ticks).toHaveLength(2);
    for (const t of ticks as { actor: string; actor_kind: string }[]) {
      expect(t.actor).toBe(userId);
      expect(t.actor_kind).toBe("contractor");
    }
    // The PC's daily draft is made by the sweep (the same route wo-updates.spec
    // drives), from the day's ticks — the employee's ticks included.
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const response = await page.request.get("/api/cron/wo-sweep?force=1", { headers: { Authorization: `Bearer ${secret}` } });
      expect(response.status()).toBe(200);
      const { data: upd } = await db!.from("wo_updates").select("draft_text, status")
        .eq("work_order_id", fixture!.workOrderId).order("for_date", { ascending: false }).limit(1);
      const u = ((upd ?? []) as { draft_text: string; status: string }[])[0];
      expect(u, "a draft for the PC").toBeTruthy();
      expect(u.status).toBe("drafted");
      expect(u.draft_text).toMatch(/Lounge|Walls/);
    }
  });

  test("can't make it raises the Reassign item for the office and changes nothing on the assignment", async ({ page, browser }) => {
    const before = (await db!.from("wo_assignments").select("status, start_date, end_date, accepted_at, is_lead").eq("id", assignmentId).single()).data;

    await signIn(page, employee, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await page.getByTestId("cant-make-it").click();
    await page.getByTestId("cant-make-it-reason").fill("E2E: medical appointment");
    await page.getByTestId("cant-make-it-send").click();
    await expect(page.getByTestId("cant-make-it-flagged")).toBeVisible({ timeout: 15_000 });

    const after = (await db!.from("wo_assignments").select("status, start_date, end_date, accepted_at, is_lead").eq("id", assignmentId).single()).data;
    expect(after).toEqual(before);
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", fixture!.workOrderId).eq("type", "assignment_cant_make_it");
    expect(ev).toHaveLength(1);
    expect((ev as { meta: { reason: string } }[])[0].meta.reason).toBe("E2E: medical appointment");

    // The office sees it on Today as a Reassign item pointing at the board.
    const office = await browser.newContext();
    const staffPage = await office.newPage();
    await signIn(staffPage, staff!, /\/(home|estimates)/);
    // The item is a follow-up in the WAITING bucket (due the day before their
    // first day, which is weeks away), and the test project's queue runs to
    // many pages of 50 — so walk the follow-ups pages until it appears.
    let found = false;
    for (let p = 1; p <= 12 && !found; p++) {
      await staffPage.goto(`/crm/today?f=followups&who=all&page=${p}`);
      await expect(staffPage.getByTestId("who-chips")).toBeVisible({ timeout: 30_000 });
      const card = staffPage.locator("text=/can't make E2E employee job/");
      if (await card.count()) {
        found = true;
        await expect(card.first()).toBeVisible();
        await expect(staffPage.locator('a[href*="/pc/schedule?from=2026-11-16"]').first()).toContainText(/Reassign/);
      } else if (!(await staffPage.getByRole("link", { name: /older/i }).count())) {
        break;
      }
    }
    expect(found, "the Reassign item is on the office's Today queue").toBe(true);
    await office.close();
  });
});
