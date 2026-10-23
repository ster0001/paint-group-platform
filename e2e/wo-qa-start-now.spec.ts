import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 23 Oct 2026: "add a button to start quality check so even if a quality check is booked
 * for a different time, or not booked at all, it can be done". On the PC job page the
 * quality-check card has Start quality check: with no check booked it adds a spot check this
 * moment and the check's card appears; with an unlogged check already on the job (booked for
 * any time) the button reads "…now" and goes to that card instead of adding another.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
let job: LoopFixture | null = null;

test.describe("Start quality check from the PC job page", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    job = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    // The fixture flags the job for a check and the job page's cadence heal books one on load;
    // this spec starts from none: flag off, any booked check removed.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job.workOrderId, p_required: false })).toMatch(/^ok/);
    const { error } = await db!.from("wo_qa_checks").delete().eq("work_order_id", job.workOrderId);
    if (error) throw new Error(error.message);
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("no check booked → one starts now and its card appears; a second press goes to it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    const start = page.getByTestId("qa-spot-check");
    await expect(start).toHaveText("Start quality check", { timeout: 30_000 });
    expect((await db!.from("wo_qa_checks").select("id").eq("work_order_id", job!.workOrderId)).data).toHaveLength(0);
    await start.click();
    await expect(page.getByTestId("qa-controls-msg")).toContainText(/Quality check started/, { timeout: 15_000 });
    const { data: checks } = await db!.from("wo_qa_checks").select("id, kind, scheduled_for, result").eq("work_order_id", job!.workOrderId);
    expect(checks).toHaveLength(1);
    const check = (checks as { id: string; kind: string; scheduled_for: string | null; result: string | null }[])[0];
    expect(check.kind).toBe("spot");
    expect(check.scheduled_for).toBeNull();
    await expect(page.getByTestId(`qa-${check.id}`)).toBeVisible({ timeout: 15_000 });
    // Booked for another time or not, an unlogged check is the one to work: the button goes to it.
    expect(await rpcAs(staff!, "wo_qa_set_schedule", { p_check_id: check.id, p_date: "2030-01-07", p_time: "09:00" })).toMatch(/^ok/);
    await page.reload();
    await expect(page.getByTestId("qa-spot-check")).toHaveText("Start quality check now", { timeout: 30_000 });
    await page.getByTestId("qa-spot-check").click();
    await expect(page.getByTestId("qa-controls-msg")).toContainText(/The check is below/);
    expect((await db!.from("wo_qa_checks").select("id").eq("work_order_id", job!.workOrderId)).data, "no second check was added").toHaveLength(1);
    // And the booked-for-2030 check logs today regardless.
    const items = (await db!.from("wo_qa_items").select("id").eq("qa_check_id", check.id)).data ?? [];
    for (const it of items as { id: string }[]) expect(await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: it.id, p_done: true })).toMatch(/^ok/);
    expect(await rpcAs(staff!, "wo_record_qa", { p_check_id: check.id, p_result: "pass", p_notes: "e2e", p_rectify: [] })).toMatch(/^ok/);
  });
});
