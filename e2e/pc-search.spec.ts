import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 1 Oct 2026: a search bar in PC Command, on every page, to find a project.
 * The fixture job is found by its reference and by its address; a stranger
 * needle says so; the box is the same one on the Schedule page; a contractor
 * gets nothing from the API at all.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let woRef = "";

test.describe("PC Command · find a project", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    const { data } = await db!.from("work_orders").select("wo_ref").eq("id", fixture.workOrderId).single();
    woRef = (data as { wo_ref: string }).wo_ref;
  });
  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  test("the reference finds the job and opens its console page", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const box = page.getByTestId("pc-search");
    await expect(box).toBeVisible();
    await box.fill(woRef);
    const hit = page.getByTestId("pc-search-hit").filter({ hasText: woRef });
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await expect(hit).toContainText("E2E tick fixture");
    await hit.click();
    await expect(page).toHaveURL(new RegExp(`/pc/wo/${fixture!.workOrderId}`), { timeout: 20_000 });
    // The navigation clears the box.
    await expect(page.getByTestId("pc-search")).toHaveValue("");
  });

  test("the address finds it too, from the Schedule page, and a stranger needle says so", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/schedule");
    const box = page.getByTestId("pc-search");
    await box.fill("1 Test St");
    await expect(page.getByTestId("pc-search-hit").filter({ hasText: woRef })).toBeVisible({ timeout: 15_000 });
    await box.fill("zzqx-no-such-project");
    await expect(page.getByTestId("pc-search-empty")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pc-search-hit")).toHaveCount(0);
  });

  test("a contractor gets nothing from the search API", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    const res = await page.request.get(`/pc/api/search?q=${encodeURIComponent(woRef)}`);
    expect(res.status()).toBe(403);
  });
});
