import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * PC Command → Contractors, Step 8 (brief §7, §8). AS PC: the strip counts
 * equal the list; a row carries the light in words, counts not percentages,
 * the trend and the tags; the sheet shows the last 10 jobs (tap a dot for
 * why) and the staff-only bonus history; Spot check puts a check on the job
 * under way; Log call back lands on the finished job's call-back form. The
 * home dashboard's Contractor tiles show the same numbers from the same model.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let contractorId = "";
let live: LoopFixture | null = null;
let done: LoopFixture | null = null;
let bonusId = "";
let callbackId = "";

test.describe.configure({ mode: "serial" });

test.describe("PC Command → Contractors", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    live = await createLoopFixture(db!, contractorId, [{ heading: "Study", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "in_progress", start_date: "2026-10-05", end_date: "2026-10-12" }).eq("id", live.workOrderId);
    await db!.from("wo_qa_checks").delete().eq("work_order_id", live.workOrderId);
    done = await createLoopFixture(db!, contractorId, [{ heading: "Lounge", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "closed", status: "complete", start_date: "2026-09-20", end_date: "2026-09-22" }).eq("id", done.workOrderId);
    await db!.from("wo_signoff").upsert({ work_order_id: done.workOrderId, signed_at: "2026-09-23T05:00:00Z", signed_name: "E2E Customer", signed_kind: "in_person", areas: {} }, { onConflict: "work_order_id" });
    const st = await db!.from("painter_status").upsert({
      painter_id: contractorId, colour: "green", streak: 5, best_streak: 5, bonus_counter: 2, line: "Your last 4 jobs were all clean.",
      measures: { checks: { passedFirstTime: 3, done: 3, band: "yellow" }, reminders: { answered: 11, scored: 12, creditsApplied: 1, band: "yellow" }, callbacks: { scored: 0, band: "yellow" } },
      offers_cleared_at: null, computed_at: new Date().toISOString(),
    }, { onConflict: "painter_id" });
    expect(st.error?.message ?? "").toBe("");
    await db!.from("painter_job_results").delete().eq("painter_id", contractorId);
    const res = await db!.from("painter_job_results").insert({ painter_id: contractorId, work_order_id: done.workOrderId, result: "not_clean", reasons: ["A call back for workmanship"], hours: 16, counts_for_bonus: true, signed_on: "2026-09-23", checks_done: 1, checks_passed: 1, moments_scored: 2, moments_answered: 2, callbacks_scored: 1, credits_applied: 0, finalised_at: new Date().toISOString() });
    expect(res.error?.message ?? "").toBe("");
    const b = await db!.from("painter_bonuses").insert({ painter_id: contractorId, trigger_wo_id: done.workOrderId, qualifying_wo_ids: [done.workOrderId], suggested_cents: 50_000, status: "paid", amount_cents: 50_000, decided_at: "2026-09-02T00:00:00Z" }).select("id").single();
    expect(b.error?.message ?? "").toBe("");
    bonusId = (b.data as { id: string }).id;
    const cb = await db!.from("wo_callbacks").insert({ work_order_id: done.workOrderId, painter_id: contractorId, source: "customer_call", reason: "workmanship", reported_on: "2026-09-25", description: "E2E paint on glass", status: "open" }).select("id").single();
    expect(cb.error?.message ?? "").toBe("");
    callbackId = (cb.data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db) return;
    if (callbackId) await db.from("wo_callbacks").delete().eq("id", callbackId);
    if (bonusId) await db.from("painter_bonuses").delete().eq("id", bonusId);
    await db.from("painter_job_results").delete().eq("painter_id", contractorId);
    await db.from("painter_status").delete().eq("painter_id", contractorId);
    for (const f of [live, done]) await destroyLoopFixture(db, f);
  });

  test("the strip counts equal the list; the row reads in words and counts; the sheet has the dots, the why and the staff-only bonus history", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/contractors");
    await expect(page.getByTestId("painter-status")).toBeVisible();
    const rows = page.getByTestId("contractor-rows");
    const n = Number(await rows.getAttribute("data-count"));
    expect(n).toBeGreaterThan(0);
    // Strip = list, for every colour.
    for (const colour of ["green", "yellow", "orange", "red", "new"]) {
      const shown = Number((await page.getByTestId(`count-${colour}`).locator("b").textContent()) ?? "0");
      expect(shown, colour).toBe(await rows.locator(`[data-colour="${colour}"]`).count());
    }
    const unsigned = Number((await page.getByTestId("count-unsigned").locator("b").textContent()) ?? "0");
    expect(unsigned).toBe(await rows.getByText("Standards not signed", { exact: true }).count());
    expect(Number((await page.getByTestId("count-callbacks").textContent()) ?? "0")).toBeGreaterThanOrEqual(1);

    const row = page.getByTestId(`painter-status-row-${contractorId}`);
    await expect(row).toHaveAttribute("data-colour", "green");
    await expect(row).toContainText("GREEN");
    await expect(row).toContainText("3/3");
    await expect(row).toContainText("11/12");
    await expect(row).not.toContainText("%");
    await expect(row).toContainText("Open call back");
    await expect(page.getByTestId(`trend-${contractorId}`)).toBeVisible();
    await row.click();
    const sheet = page.getByTestId(`painter-sheet-${contractorId}`);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".ctr-dot.slip")).toHaveCount(1);
    await sheet.locator(".ctr-dot.slip").click();
    await expect(page.getByTestId("painter-dot-why")).toContainText("A call back for workmanship");
    await expect(page.getByTestId(`bonus-history-${contractorId}`)).toContainText("$500");
  });

  test("Spot check puts a spot check on the job under way; Log call back lands on the finished job's form", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/contractors");
    await page.getByTestId(`painter-status-row-${contractorId}`).click();
    await page.getByTestId(`spot-${contractorId}`).click();
    await page.getByTestId(`spot-job-${live!.workOrderId}`).click();
    await expect(page.getByTestId("contractors-msg")).toContainText(/Spot check added/);
    const { data: checks } = await db!.from("wo_qa_checks").select("kind, trigger").eq("work_order_id", live!.workOrderId);
    expect(checks).toEqual([{ kind: "spot", trigger: "spot" }]);

    await page.getByTestId(`logcb-${contractorId}`).click();
    await page.getByTestId(`logcb-job-${done!.workOrderId}`).click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${done!.workOrderId}#callbacks`));
    await expect(page.getByTestId("callbacks")).toBeVisible();
  });

  test("the home dashboard's Contractor tiles read the same model: Painters on Green equals the strip", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/contractors");
    const green = Number((await page.getByTestId("count-green").locator("b").textContent()) ?? "0");
    const bonus = Number((await page.getByTestId("count-bonus").textContent()) ?? "0");
    await page.goto("/home");
    await expect(page.getByTestId("section-contractors")).toBeVisible({ timeout: 30_000 });
    const tile = page.getByTestId("tile-value-contractors.on_green");
    await expect(tile).toBeVisible();
    expect(Number(((await tile.textContent()) ?? "").replace(/[^\d]/g, ""))).toBe(green);
    expect(Number(((await page.getByTestId("tile-value-contractors.bonus_due").textContent()) ?? "").replace(/[^\d]/g, ""))).toBe(bonus);
    await page.getByTestId("tile-contractors.on_green").click();
    await expect(page.getByTestId("drill-contractors.on_green")).toContainText("Green");
  });
});
