import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * The PC Command console, driven as the PC.
 *
 * The claim under test is the brief's: every number on this screen is read from
 * the model. So the tests put facts into the database and check the console
 * shows them — never the reverse.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let variationId = "";

test.describe("PC Command", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls", "Windows"] },
      { heading: "Left", labels: ["Eaves"] },
    ]);
    await db!.from("estimates").update({ total_cents: 1_842_000 }).eq("id", fixture.estimateId);
    await db!.from("work_orders").update({ contractor_payment_cents: 786_000 }).eq("id", fixture.workOrderId);
    await db!.from("wo_surfaces").update({ state: "done" })
      .eq("work_order_id", fixture.workOrderId).eq("heading", "Front");

    const { data: photo } = await db!.from("wo_photos").insert({
      work_order_id: fixture.workOrderId, kind: "variation",
      storage_path: `wo/${fixture.workOrderId}/v.jpg`,
    }).select("id").single();

    const { data: v } = await db!.from("wo_variations").insert({
      work_order_id: fixture.workOrderId, category: "rot",
      comment: "Three lower boards on the left are soft right through.",
      est_hours: 3, status: "raised",
    }).select("id").single();
    variationId = (v as { id: string }).id;
    await db!.from("wo_photos").update({ variation_id: variationId }).eq("id", (photo as { id: string }).id);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  test("a contractor cannot reach the console at all", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/pc");
    await expect(page).toHaveURL(/\/portal/);
  });

  test("the queue raises exactly one card for the waiting variation", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");

    const card = page.getByTestId(`card-variation-price:${variationId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Variation waiting on a price");
    await expect(page.getByTestId(`action-variation-price:${variationId}`)).toContainText("Price it");
  });

  test("the tiles agree with the queue, because they come from it", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");

    const waiting = Number(await page.getByTestId("tile-waiting").textContent());
    const warnings = await page.locator('[data-testid^="card-"].al-warn').count();
    expect(waiting).toBe(warnings);

    const critical = Number(await page.getByTestId("tile-critical").textContent());
    expect(critical).toBe(await page.locator('[data-testid^="card-"].al-crit').count());

    // The fixture's contract value is on the books.
    await expect(page.getByTestId("tile-books")).toContainText("$");
  });

  test("the job sits in the lane the model says it sits in", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc/flow");

    const lane = page.getByTestId("lane-in_progress");
    await expect(lane.getByTestId(`job-${fixture!.workOrderId}`)).toBeVisible();
    // And nowhere else.
    for (const stage of ["offered", "pre_start", "qa", "completion_prep", "walkthrough", "closed"]) {
      await expect(page.getByTestId(`lane-${stage}`).getByTestId(`job-${fixture!.workOrderId}`)).toHaveCount(0);
    }
  });

  test("the queue action deep-links to the variation it is about", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");
    await page.getByTestId(`action-variation-price:${variationId}`).click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${fixture!.workOrderId}`));
    await expect(page.getByTestId(`variation-${variationId}`)).toBeVisible();
  });

  test("the work-order view reads its numbers from the model", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    await expect(page.getByTestId("money-contract")).toHaveText("$18,420");
    // GP is derived: (18420 - 7860) / 18420 = 57.3%
    await expect(page.getByTestId("money-gp")).toHaveText("57.3%");
    // An open variation shows as pending rather than a number nobody has agreed.
    await expect(page.getByTestId("money-variations")).toHaveText("+ pending");
    // Two of three surfaces done, from the rows themselves.
    await expect(page.getByTestId("tick-count")).toHaveText("2 / 3");
    // The stage rail marks in_progress as current.
    await expect(page.getByTestId("rail-in_progress")).toHaveClass(/\bc\b/);
  });

  test("the PC prices the variation from the console, and the money is the server's", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    await page.getByTestId(`hours-${variationId}`).fill("3");
    await expect(page.getByTestId(`preview-${variationId}`)).toContainText("$180.00");

    await page.getByTestId(`price-${variationId}`).click();
    await expect(page.getByTestId(`variation-msg-${variationId}`)).toContainText("customer has it now");

    const { data } = await db!.from("wo_variations")
      .select("status, price_cents, contractor_delta_cents, contractor_rate_cents")
      .eq("id", variationId).single();
    const v = data as {
      status: string; price_cents: number; contractor_delta_cents: number; contractor_rate_cents: number;
    };
    expect(v.status).toBe("priced");
    expect(v.contractor_rate_cents).toBe(6000);
    expect(v.contractor_delta_cents).toBe(18000);   // 3 × $60, worked out in SQL
    expect(v.price_cents).toBeGreaterThan(0);       // and the customer side by the engine
  });

  test("the card clears itself once the variation moves on", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");
    // It was raised; it is priced now, so the "needs a price" card is gone.
    await expect(page.getByTestId(`card-variation-price:${variationId}`)).toHaveCount(0);
  });

  test("a silent site shows as critical", async ({ page }) => {
    const { error } = await db!.from("wo_events").insert({
      work_order_id: fixture!.workOrderId, type: "zero_tick_flag", actor_kind: "system",
      meta: { date: new Date().toISOString().slice(0, 10), wo_ref: "WO-E2E" },
    });
    expect(error).toBeNull();

    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");

    await expect(page.getByTestId(`card-zero-tick:${fixture!.workOrderId}`)).toBeVisible();
    await expect(page.getByTestId("tile-critical")).toHaveText("1");
  });

  test("the PC reviews, edits and sends a drafted update", async ({ page }) => {
    const { data } = await db!.from("wo_updates").insert({
      work_order_id: fixture!.workOrderId,
      for_date: new Date().toISOString().slice(0, 10),
      draft_text: "Good afternoon — today we completed the front of the house.",
      status: "drafted", photo_count: 2,
    }).select("id").single();
    const updateId = (data as { id: string }).id;

    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc/updates");

    await expect(page.getByTestId(`text-${updateId}`)).toContainText("front of the house");
    await page.getByTestId(`edit-toggle-${updateId}`).click();
    await page.getByTestId(`edit-${updateId}`).fill("Good afternoon Melissa — the front is finished and looks terrific.");
    await page.getByTestId(`send-${updateId}`).click();
    await expect(page.getByTestId(`sent-${updateId}`)).toBeVisible();

    const { data: after } = await db!.from("wo_updates")
      .select("status, final_text, sent_at").eq("id", updateId).single();
    const u = after as { status: string; final_text: string; sent_at: string | null };
    expect(u.status).toBe("sent");
    expect(u.final_text).toContain("looks terrific");   // the PC's words, not the draft
    expect(u.sent_at).not.toBeNull();
  });
});
