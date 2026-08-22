import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * The control that was missing: a job could reach pre-start and stop there for
 * ever, because nothing in the UI called wo_advance_stage. Tom found it by
 * trying to start a real job and having nowhere to press.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;

test.describe.configure({ mode: "serial" });

test.describe("moving a job forward from the console", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({ stage: "pre_start" }).eq("id", job.workOrderId);
    await rpcAs(staff!, "wo_seed_checklists", { p_work_order_id: job.workOrderId });
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("a job at pre-start offers 'Start the job'", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await expect(page.getByTestId("stage-advance")).toBeVisible();
    await expect(page.getByTestId("advance-in_progress")).toContainText("Start the job");
  });

  test("pressing it while the list is outstanding explains why, in the gate's words", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await page.getByTestId("advance-in_progress").click();
    await expect(page.getByTestId("stage-message")).toContainText("colour schedule is not finalised");

    const { data } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    expect((data as { stage: string }).stage).toBe("pre_start");
  });

  test("with the list true, the same button starts the job", async ({ page }) => {
    await db!.from("work_orders").update({
      colours: { Weathershield: { name: "Vivid White", hex: "#fff", status: "confirmed" } },
    }).eq("id", job!.workOrderId);

    const { data: items } = await db!.from("wo_checklist_items")
      .select("id, auto_key, required")
      .eq("work_order_id", job!.workOrderId).eq("phase", "pre_start");
    for (const i of (items as { id: string; auto_key: string | null; required: boolean }[])) {
      if (i.auto_key || !i.required) continue;
      await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: i.id, p_done: true });
    }

    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await page.getByTestId("advance-in_progress").click();
    await expect(page.getByTestId("stage-moved")).toContainText("In progress");

    const { data } = await db!.from("work_orders").select("stage, status").eq("id", job!.workOrderId).single();
    expect((data as { stage: string }).stage).toBe("in_progress");
    expect((data as { status: string }).status).toBe("in_progress");
  });

  test("the console never offers a move the machine would call illegal", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    // From in_progress the only forward moves are QA and completion prep.
    await expect(page.getByTestId("advance-qa")).toBeVisible();
    await expect(page.getByTestId("advance-completion_prep")).toBeVisible();
    await expect(page.getByTestId("advance-closed")).toHaveCount(0);
    await expect(page.getByTestId("advance-walkthrough")).toHaveCount(0);
  });

  test("sending the pack mints the customer's link, not just a stage change", async ({ page }) => {
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job!.workOrderId);
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "completion_prep" });
    const { data: items } = await db!.from("wo_checklist_items")
      .select("id").eq("work_order_id", job!.workOrderId).eq("phase", "completion_prep");
    for (const i of (items as { id: string }[])) {
      await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: i.id, p_done: true });
    }

    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);
    await page.getByTestId("advance-walkthrough").click();
    await expect(page.getByTestId("stage-moved")).toContainText("Walkthrough");

    // The customer has something to open — a stage move alone would not do this.
    const { data } = await db!.from("wo_signoff")
      .select("customer_token, evidence_pack_sent_at").eq("work_order_id", job!.workOrderId).single();
    expect((data as { customer_token: string | null }).customer_token).toBeTruthy();
    expect((data as { evidence_pack_sent_at: string | null }).evidence_pack_sent_at).toBeTruthy();
  });
});
