import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  photosIn, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 22 Oct 2026: "please update so a quality check can be ticked off before
 * all the boxes have been ticked, so we can quality check before a job is
 * finished."
 *
 * The database never minded: wo_record_qa has no stage test, the check rows
 * exist from the moment the office ticks Quality check required (or the page
 * self-heals the cadence at pre-start). What held the office back was the PC
 * job page, which drew an UNLOGGED check card at In progress only when a site
 * check-in's day had come — the main check waited for the painter's finish.
 *
 * Now every check on the job is on the page from In progress, marked as
 * logged before the finish. This story drives the real cards on a job with
 * one of two boxes ticked:
 *
 *   1. the office FAILS the check mid-job → the rectification is on the
 *      painter's list at once, the job stays In progress, a re-check exists;
 *   2. the office PASSES the re-check mid-job → still In progress, nothing
 *      routed, the message says so;
 *   3. the painter ticks the last boxes and finishes → the job skips the
 *      Quality check lane (open count 0) and the office signs it off.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const HEADING = "Front";
let job: LoopFixture | null = null;
let failedId = "";
let recheckId = "";

async function stageNow(): Promise<string> {
  const { data } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
  return (data as { stage: string }).stage;
}

async function openChecks(): Promise<number> {
  const { data, error } = await db!.rpc("wo_qa_open_count", { p_work_order_id: job!.workOrderId });
  if (error) throw new Error(`wo_qa_open_count: ${error.message}`);
  return Number(data);
}

test.describe.configure({ mode: "serial" });

test.describe("a quality check is logged before the painter has finished", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: HEADING, labels: ["Walls", "Ceiling"] }]);
    // The office wants this job checked — the cadence is not under test. The
    // tick schedules the check at once, so the card exists before any finish.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job.workOrderId, p_required: true }))
      .toMatch(/^ok/);
    // ONE of the two boxes ticked: the job is under way, not finished.
    const { error } = await db!.from("wo_surfaces").update({ state: "done" }).eq("id", job.surfaces[0].id);
    if (error) throw new Error(`fixture tick: ${error.message}`);
    expect(await stageNow()).toBe("in_progress");
    expect(await openChecks()).toBe(1);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("1 · the office opens an In-progress job, sees the check card, and FAILS it — rectification raised, job still in progress", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);

    const card = page.locator('.card[data-testid^="qa-"]').filter({ has: page.locator('[data-testid^="qa-item-"]') }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toHaveAttribute("data-early", "1");
    await expect(card).toContainText(/before the finish/i);
    failedId = ((await card.getAttribute("data-testid")) ?? "").replace("qa-", "");
    expect(failedId).toBeTruthy();

    await card.getByTestId(`qa-fail-${failedId}`).click();
    await card.getByTestId(`qa-where-${failedId}`).fill(HEADING);
    await card.getByTestId(`qa-what-${failedId}`).fill("Walls — runs under the window, sand back and recoat.");
    await card.getByTestId(`qa-confirm-fail-${failedId}`).click();
    await expect(page.getByTestId(`qa-result-${failedId}`)).toContainText("FAIL", { timeout: 30_000 });

    // The job never left In progress; the painter has the rectification on
    // the same list they are working through; the re-check already exists.
    expect(await stageNow()).toBe("in_progress");
    const { data: rect } = await db!.from("wo_surfaces")
      .select("heading, label, state").eq("work_order_id", job!.workOrderId).eq("rectification", true);
    expect(rect).toEqual([{ heading: HEADING, label: "Walls — runs under the window, sand back and recoat.", state: "todo" }]);

    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id, result, retry_of").eq("work_order_id", job!.workOrderId);
    const list = (checks ?? []) as { id: string; result: string | null; retry_of: string | null }[];
    expect(list.find((c) => c.id === failedId)?.result).toBe("fail");
    const recheck = list.find((c) => c.retry_of === failedId);
    expect(recheck, "the fail spawned its re-check").toBeTruthy();
    recheckId = recheck!.id;
    expect(await openChecks()).toBe(1);
  });

  test("2 · the office PASSES the re-check, still mid-job — recorded, nothing routed, and the message says so", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);

    const re = page.getByTestId(`qa-${recheckId}`);
    await expect(re).toBeVisible({ timeout: 60_000 });
    await expect(re).toHaveAttribute("data-early", "1");
    await expect(re).toContainText(/re-check/i);
    for (const item of await re.locator('[data-testid^="qa-item-"]').all()) {
      await item.click();
      await expect(item).toHaveClass(/on/, { timeout: 15_000 });
    }
    await re.getByTestId(`qa-pass-${recheckId}`).click();
    await expect(page.getByTestId(`qa-msg-${recheckId}`)).toContainText(/before the painter finished/i, { timeout: 30_000 });
    await expect(page.getByTestId(`qa-msg-${recheckId}`)).toContainText(/skips the Quality check lane/i);

    expect(await stageNow()).toBe("in_progress");
    expect(await openChecks()).toBe(0);
    const { data: so } = await db!.from("wo_signoff").select("customer_token").eq("work_order_id", job!.workOrderId).maybeSingle();
    expect((so as { customer_token: string | null } | null)?.customer_token ?? null, "no pack goes out mid-job").toBeNull();
  });

  test("3 · the painter ticks the last boxes and finishes — the job skips the Quality check lane and is the office's to sign off", async () => {
    const { error } = await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job!.workOrderId);
    if (error) throw new Error(`ticks: ${error.message}`);
    await photosIn(db!, job!.workOrderId);

    // No qa_pending on the finish: the check is already passed.
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: job!.workOrderId }))
      .toBe("ok:completion_prep");
    await completePrep(db!, contractor!, job!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: job!.workOrderId }))
      .toBe("ok:walkthrough");
    expect(await stageNow()).toBe("walkthrough");

    const { data: signs } = await db!.rpc("wo_staff_signs_off", { p_work_order_id: job!.workOrderId });
    expect(signs, "a passed check means the office signs the job off").toBe(true);

    const { data: ev } = await db!.from("wo_events")
      .select("type, from_stage, to_stage").eq("work_order_id", job!.workOrderId).order("created_at");
    const events = (ev ?? []) as { type: string; from_stage: string | null; to_stage: string | null }[];
    expect(events.filter((e) => e.type === "qa_fail").length).toBe(1);
    expect(events.filter((e) => e.type === "qa_pass").length).toBe(1);
    const moves = events.filter((e) => e.type === "stage_changed").map((e) => `${e.from_stage}>${e.to_stage}`);
    expect(moves).not.toContain("completion_prep>qa");
    expect(moves).toEqual(["in_progress>completion_prep", "completion_prep>walkthrough"]);
  });
});
