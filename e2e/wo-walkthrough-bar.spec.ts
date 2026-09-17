import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom (17 Sep): "once all of the check boxes have been done, a Start
 * walkthrough button fixed to the top of the page — currently I can't get to
 * the walkthrough." The Walkthrough & sign-off card sat under the tick list,
 * the photos, the finishing-up list, colours, dates and the crew link, so on
 * a phone it was a long scroll to find, and before the finish press it did
 * not exist at all.
 *
 * The bar pins under the portal header the moment every working surface is
 * done and stays through the finish, the quality check's pass and the
 * walkthrough stage. One press does whatever is next: the finish (routed by
 * the server — a quality check first, when one is due) and then the
 * walkthrough itself.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let doneFixture: LoopFixture | null = null;
let walkFixture: LoopFixture | null = null;

async function readyForWalkthrough(f: LoopFixture) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await completePrep(db!, staff!, f.workOrderId);
  await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: f.workOrderId, p_to: "completion_prep" });
  const result = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: f.workOrderId });
  expect(result).toMatch(/^ok:/);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  const booked = await rpcAs(staff!, "wo_book_walkthrough",
    { p_work_order_id: f.workOrderId, p_kind: "final", p_date: today, p_note: "" });
  expect(booked).toMatch(/^ok:/);
}

test.describe("the pinned Start-the-walkthrough bar on the painter's job", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    doneFixture = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls", "Ceiling"] }]);
    walkFixture = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    await readyForWalkthrough(walkFixture!);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, doneFixture);
    await destroyLoopFixture(db!, walkFixture);
  });

  test("no bar while a surface is still to do; it pins to the top once every box is ticked", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${doneFixture!.workOrderId}`);
    await expect(page.getByTestId("tick-list")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("walkthrough-bar")).toHaveCount(0);

    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", doneFixture!.workOrderId);
    await page.reload();
    const bar = page.getByTestId("walkthrough-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar.getByTestId("walkthrough-bar-start")).toHaveText(/start the walkthrough/i);

    // PINNED: scroll to the foot of the page and the bar is still on screen,
    // directly under the portal header — not somewhere in the scroll.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const box = await bar.boundingBox();
    const header = await page.locator(".pt .hd").boundingBox();
    expect(box).not.toBeNull();
    expect(header).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
    expect(box!.y).toBeLessThan(header!.y + header!.height + 24);

    // The finishing-up list gates it in the gate's own words, then the press
    // finishes the job and the SERVER routes it — this contractor's jobs are
    // quality checked, so the bar says so instead of opening the walkthrough.
    await bar.getByTestId("walkthrough-bar-start").click();
    await expect(bar.getByTestId("walkthrough-bar-msg")).toContainText(/still to tick/i, { timeout: 15_000 });
    await completePrep(db!, staff!, doneFixture!.workOrderId);
    await bar.getByTestId("walkthrough-bar-start").click();
    await expect(bar.getByTestId("walkthrough-bar-msg")).toContainText(/quality check/i, { timeout: 15_000 });
  });

  test("at the walkthrough stage the bar opens the customer's view in one press", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${walkFixture!.workOrderId}`);
    const bar = page.getByTestId("walkthrough-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await bar.getByTestId("walkthrough-bar-start").click();
    await page.waitForURL(/\/s\/[a-f0-9]{64}/, { timeout: 20_000 });
    await expect(page.locator("h1")).toContainText(/finished/i);
  });
});
