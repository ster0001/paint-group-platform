import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 27 Oct 2026: "remove all movements reminders from the dashboard". A movement placed
 * on a painter YESTERDAY and never ticked is an overdue item in the queue (the Movements map
 * still shows it as a red warning); PC Command's Needs you now no longer draws it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const RUN = Math.random().toString(36).slice(2, 8);
const melbourne = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const TODAY = melbourne.format(new Date());

let job: LoopFixture | null = null;
const title = `E2E overdue sundries ${RUN}`;

test.describe("PC Command: no movements reminders in Needs you now", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture");

  test.beforeAll(async () => {
    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    const { error } = await db!.from("work_orders").update({ stage: "in_progress", start_date: addDays(TODAY, -3), end_date: addDays(TODAY, 3) }).eq("id", job.workOrderId);
    if (error) throw new Error(error.message);
    const made = await rpcAs(staff!, "movement_create", { p: { kind: "materials", work_order_id: job.workOrderId, title, from: { kind: "warehouse" }, to: { kind: "site" } } });
    expect(made).toMatch(/^ok:/);
    expect(await rpcAs(staff!, "movement_place", { p_id: made.replace(/^ok:/, ""), p_assignee_kind: "person", p_assignee_id: contractorId, p_due_date: addDays(TODAY, -1), p_half: "AM", p_time: "07:30" })).toMatch(/^ok:/);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("the overdue movement is not a card on the dashboard", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    await expect(page.getByTestId("queue")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("queue")).not.toContainText(title);
    expect(await page.locator('[data-testid="queue"] [data-kind^="movement"], [data-testid="queue"] [data-kind="order_unplaced"], [data-testid="queue"] [data-kind="agreement_unsigned"]').count()).toBe(0);
  });
});
