import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 23 Aug: "after the completion report is filled in it goes to a 404".
 * Mode A: the painter hands the phone over, the customer approves and signs —
 * wo_sign then NULLS the session token, and the old page revalidated itself
 * against that dead token → notFound. Now the sign page says thank-you and the
 * device goes BACK to the painter's job page, which shows the job complete.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
let f: LoopFixture | null = null;

test.describe("on-device sign-off returns to the job, shown complete", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
    await completePrep(db!, staff!, f.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: f.workOrderId })).toMatch(/^ok:completion_prep/);
    // Pass whatever checks exist, then confirm → walkthrough (pack delivered).
    const { data: checks } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", f.workOrderId);
    for (const c of (checks ?? []) as { id: string }[]) {
      const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
      for (const item of (items ?? []) as { id: string }[]) await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
      await rpcAs(staff!, "wo_record_qa", { p_check_id: c.id, p_result: "pass", p_notes: "e2e", p_rectify: [] });
    }
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: f.workOrderId })).toMatch(/^ok:(qa|walkthrough)/);
    await rpcAs(staff!, "wo_qa_route_passed", { p_work_order_id: f.workOrderId });
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, f); });

  test("painter starts the walkthrough, customer approves and signs, device lands back on the job — complete", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${f!.workOrderId}`);
    await page.getByTestId("start-walkthrough").click();
    await page.waitForURL(/\/s\/[a-f0-9]{64}\?back=/, { timeout: 20_000 });

    await page.getByTestId("approve-Front").click();
    await expect(page.getByTestId("ok-Front")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("sign-name").fill("Melissa Hartley");
    await page.getByTestId("sign").click();
    await expect(page.getByTestId("signed")).toBeVisible({ timeout: 15_000 });

    // No 404: the device returns to the painter's job page on its own.
    await page.waitForURL(new RegExp(`/portal/jobs/${f!.workOrderId}`), { timeout: 20_000 });
    await expect(page.getByTestId("job-complete")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("job-complete")).toContainText(/Melissa Hartley/);

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", f!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("closed");
  });

  test("the closed job sits in the board's Closed lane, and staff can reopen it for sign-off", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc/flow");
    await expect(page.getByTestId("lane-closed")).toContainText(/final invoice sent/i, { timeout: 15_000 });
    await expect(page.getByTestId("lane-closed").getByTestId(`job-${f!.workOrderId}`)).toBeVisible();

    // Reopen: staff only, closed only, back to Walkthrough unsigned.
    expect(await rpcAs(contractor!, "wo_reopen_signoff", { p_work_order_id: f!.workOrderId, p_reason: "x" })).toBe("error:not_staff");
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    await page.getByTestId("reopen-open").click();
    await page.getByTestId("reopen-reason").fill("Customer rang — run in the hallway paint");
    await page.getByTestId("reopen-confirm").click();
    await expect(page.getByTestId("stage-moved")).toContainText(/Walkthrough/, { timeout: 15_000 });

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", f!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("walkthrough");
    const { data: so } = await db!.from("wo_signoff").select("signed_at, customer_token").eq("work_order_id", f!.workOrderId).maybeSingle();
    expect((so as { signed_at: string | null }).signed_at).toBeNull();
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", f!.workOrderId).eq("type", "signoff_reopened");
    expect((ev ?? []).length).toBe(1);
    // Only one warranty, still from the first signing; no duplicate draft stub.
    const { data: warranty } = await db!.from("warranties").select("id").eq("work_order_id", f!.workOrderId);
    expect((warranty ?? []).length).toBe(1);
    // Reopening twice: not closed any more.
    expect(await rpcAs(staff!, "wo_reopen_signoff", { p_work_order_id: f!.workOrderId, p_reason: "" })).toBe("error:not_closed");
  });
});
