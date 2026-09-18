import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * One painter's detail page, and removing a painter (Tom, 18 Sep 2026).
 *
 *  · The office opens a painter from the list and sees their mobile, their
 *    crew size, their paperwork, their jobs and their quality-check record.
 *  · Remove REFUSES, by name, for a painter with history — because
 *    `work_orders.contractor_id` is ON DELETE SET NULL and nine other tables
 *    cascade, so deleting them would strip their jobs of a painter and take
 *    their insurance certificates with them.
 *  · Remove works for a row that never did anything, which is what it is for.
 *
 * Everything made here is removed at the end.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const SPARE_NAME = `E2E Spare Painter ${run}`;
let spareUserId = "";
let spareContractorId = "";
let realContractorId: string | null = null;
let fixture: LoopFixture | null = null;

test.describe("a painter's detail page, and removing one", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the throwaway painter");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    realContractorId = await contractorIdForEmail(db!, contractor!.email);
    // A painter with no history at all — the only kind Remove is for.
    const created = await db!.auth.admin.createUser({
      email: `pg.e2e.spare.${run}@example.com`, password: `Spare-${run}-pw!`,
      email_confirm: true, user_metadata: { name: SPARE_NAME },
    });
    if (created.error || !created.data.user) throw new Error(`create spare: ${created.error?.message}`);
    spareUserId = created.data.user.id;
    const prof = await db!.from("profiles").update({ role: "contractor", name: SPARE_NAME }).eq("id", spareUserId);
    if (prof.error) throw new Error(prof.error.message);
    const c = await db!.from("contractors")
      .insert({ profile_id: spareUserId, tier: "C", active: true, company_name: `Spare Co ${run}`, crew_size: 3, phone: "0400 111 222" })
      .select("id").single();
    if (c.error) throw new Error(c.error.message);
    spareContractorId = (c.data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (fixture) await destroyLoopFixture(db!, fixture);
    if (spareContractorId) await db!.from("contractors").delete().eq("id", spareContractorId);
    if (spareUserId) {
      const r = await db!.auth.admin.deleteUser(spareUserId);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("the list opens a painter, and their page carries the details, jobs and quality checks", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/contractors");
    await page.getByTestId(`open-${spareContractorId}`).click();

    await expect(page).toHaveURL(new RegExp(`/contractors/${spareContractorId}$`));
    await expect(page.getByTestId("painter-name")).toHaveText(SPARE_NAME);
    // The things Tom asked to see on it.
    await expect(page.getByTestId("card-who")).toContainText("0400 111 222");
    await expect(page.getByTestId("card-who")).toContainText(`pg.e2e.spare.${run}@example.com`);
    await expect(page.getByTestId("crew-size")).toHaveText("3");
    await expect(page.getByTestId("card-docs")).toBeVisible();
    await expect(page.getByTestId("card-qa")).toBeVisible();
    await expect(page.getByTestId("card-jobs")).toContainText("They have never been on a job");
    await expect(page.getByTestId("jobs-tally")).toContainText("0 completed");
  });

  test("a painter with jobs behind them shows those jobs and their quality checks", async ({ page }) => {
    test.skip(!realContractorId, "the e2e contractor has no contractors row");
    fixture = await createLoopFixture(db!, realContractorId!, [{ heading: "Kitchen", labels: ["Walls"] }]);
    const { data: check, error } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: fixture.workOrderId, kind: "final", result: "pass", notes: "E2E detail check", checked_at: new Date().toISOString() })
      .select("id").single();
    if (error) throw new Error(error.message);

    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/contractors/${realContractorId}`);
    await expect(page.getByTestId(`job-${fixture.workOrderId}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`qa-${(check as { id: string }).id}`)).toContainText("E2E detail check");
    await expect(page.getByTestId(`qa-${(check as { id: string }).id}`)).toContainText("Passed");
    await expect(page.getByTestId("qa-tally")).toContainText("passed");
  });

  test("Remove refuses a painter with a job behind them, and names it", async ({ page }) => {
    test.skip(!realContractorId || !fixture, "needs the fixture job from the previous step");
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/contractors/${realContractorId}`);
    await page.getByTestId("delete-open").click();
    await page.getByTestId("delete-confirm-input").fill("DELETE");
    await page.getByTestId("delete-go").click();
    await expect(page.getByTestId("delete-message")).toContainText(/Suspend access instead/, { timeout: 20_000 });

    // Still there, and so is the job it refused over.
    const { data: still } = await db!.from("contractors").select("id").eq("id", realContractorId!).maybeSingle();
    expect(still, "the painter is untouched").not.toBeNull();
    const { data: job } = await db!.from("work_orders").select("contractor_id").eq("id", fixture!.workOrderId).single();
    expect((job as { contractor_id: string | null }).contractor_id, "the job kept its painter").toBe(realContractorId);
  });

  test("Remove takes away a painter who never did anything, and needs the word typed first", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/contractors/${spareContractorId}`);
    await page.getByTestId("delete-open").click();
    // The button stays shut until the word is right.
    await expect(page.getByTestId("delete-go")).toBeDisabled();
    await page.getByTestId("delete-confirm-input").fill("delete");
    await expect(page.getByTestId("delete-go")).toBeDisabled();
    await page.getByTestId("delete-confirm-input").fill("DELETE");
    await expect(page.getByTestId("delete-go")).toBeEnabled();
    await page.getByTestId("delete-go").click();
    // If it refuses, fail with the reason rather than a bare timeout.
    if (await page.getByTestId("delete-message").count()) {
      throw new Error(`delete refused: ${await page.getByTestId("delete-message").innerText()}`);
    }

    // Strict: /contractors exactly, NOT /contractors/<id> — the detail page
    // matches a loose pattern and made this assertion pass while nothing happened.
    await expect(page).toHaveURL(/\/contractors(\?|$)/, { timeout: 20_000 });
    await expect(page.getByTestId(`open-${spareContractorId}`)).toHaveCount(0);
    const { data: gone } = await db!.from("contractors").select("id").eq("id", spareContractorId).maybeSingle();
    expect(gone).toBeNull();
    spareContractorId = ""; // teardown has nothing left to do
  });

  test("the RPC refuses a painter who is not staff's to remove, and an unknown id", async () => {
    expect(await rpcAs(contractor!, "delete_contractor", { p_id: realContractorId })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "delete_contractor", { p_id: "00000000-0000-0000-0000-000000000000" })).toBe("error:not_found");
  });
});
