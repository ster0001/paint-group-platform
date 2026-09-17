import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Flagged at the walkthrough, put right, complete (Tom, 17 Sep 2026).
 *
 * "If something gets flagged and then the painter completes it, it goes back
 *  to the walkthrough bar which currently does nothing. Once any flagged
 *  areas are fixed, mark it so the flagged areas are sent to the customer
 *  along with the completion report and the job is deemed finished."
 *
 * Before: the finish after a fix re-ran the tail — a fresh quality check
 * where one was due, a second pack, a second walkthrough. Now the painter's
 * one press (the pinned bar or the card, same action) completes the job:
 * the customer's report carries what they flagged and what was done, the
 * warranty starts, and nobody walks the job twice. Customer side driven
 * anonymously, painter side in their own session.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let token = "";

test.describe("flagged → put right → complete, no second walkthrough", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls"] },
      { heading: "Left", labels: ["Walls"] },
    ]);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", fixture.workOrderId);
    await completePrep(db!, staff!, fixture.workOrderId);
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fixture.workOrderId, p_to: "completion_prep" });
    const pack = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: fixture.workOrderId });
    expect(pack).toMatch(/^ok:/);
    token = pack.slice(3);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("the customer approves one area and flags another — the job goes back to the painter", async ({ page }) => {
    await page.goto(`/s/${token}`);
    await page.getByTestId("approve-Front").click();
    await expect(page.getByTestId("ok-Front")).toBeVisible();
    await page.getByTestId("flag-Left").click();
    await page.getByTestId("note-Left").fill("There's a run in the paint by the downpipe.");
    await page.getByTestId("send-flag-Left").click();
    await expect(page.getByTestId("flagged-Left")).toBeVisible();

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("in_progress");
  });

  test("until the flagged area is ticked there is no bar, and the completion is refused in the gate's words", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await expect(page.getByTestId("tick-list")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tick-list")).toContainText(/run in the paint/);
    await expect(page.getByTestId("walkthrough-bar")).toHaveCount(0);

    const refused = await rpcAs(contractor!, "wo_complete_after_rectification", { p_work_order_id: fixture!.workOrderId });
    expect(refused).toMatch(/^error:gate:1 flagged area still to put right/);
  });

  test("put right and ticked → the bar reads Fixed — send the report, and one press completes the job", async ({ page }) => {
    // The after photo the tick needs, then the tick — the painter's own RPC.
    await db!.from("wo_photos").insert({
      work_order_id: fixture!.workOrderId, kind: "completion", area: "Left",
      storage_path: `wo/${fixture!.workOrderId}/after-left-e2e.jpg`, caption: "",
    });
    const { data: rect } = await db!.from("wo_surfaces").select("id")
      .eq("work_order_id", fixture!.workOrderId).eq("rectification", true);
    for (const r of (rect ?? []) as { id: string }[]) {
      expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: r.id, p_to: "done" })).toBe("ok:done");
    }

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    const bar = page.getByTestId("walkthrough-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveAttribute("data-phase", "rectified");
    await expect(bar).toContainText(/flagged Left/);
    await expect(bar.getByTestId("walkthrough-bar-start")).toHaveText(/Fixed — send the report/);
    // The card below is the same door, not a different one.
    await expect(page.getByTestId("finish-job")).toHaveText(/Fixed — send the report/);

    await bar.getByTestId("walkthrough-bar-start").click();
    await expect(bar.getByTestId("walkthrough-bar-msg")).toContainText(/job is complete/i, { timeout: 20_000 });
    await expect(page.getByTestId("job-complete")).toBeVisible({ timeout: 15_000 });
  });

  test("closed, warranted, and the frozen report names what was flagged and put right", async () => {
    const { data: wo } = await db!.from("work_orders").select("stage, status").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string; status: string }).stage).toBe("closed");
    expect((wo as { status: string }).status).toBe("complete");

    const { data: w } = await db!.from("warranties").select("signed_kind, years").eq("work_order_id", fixture!.workOrderId).single();
    expect((w as { signed_kind: string; years: number }).signed_kind).toBe("rectified");
    expect((w as { years: number }).years).toBe(2);

    const { data: so } = await db!.from("wo_signoff").select("signed_kind, areas, report")
      .eq("work_order_id", fixture!.workOrderId).single();
    const s = so as { signed_kind: string; areas: Record<string, { flagged_at?: string; rectified_at?: string }>;
      report: { rectified: { area: string; note: string }[]; signed_kind: string } };
    expect(s.signed_kind).toBe("rectified");
    expect(s.areas.Left.flagged_at).toBeTruthy();
    expect(s.areas.Left.rectified_at).toBeTruthy();
    expect(s.report.rectified).toEqual([expect.objectContaining({ area: "Left", note: expect.stringContaining("run in the paint") })]);
  });

  test("the customer's own link shows the completion, with what they flagged and what was done", async ({ page }) => {
    await page.goto(`/s/${token}`);
    await expect(page.getByTestId("signed")).toContainText(/areas you flagged have been put right/i);
    await expect(page.getByTestId("completion-report")).toBeVisible();
    await expect(page.getByTestId("report-completion-line")).toContainText(/once the areas you flagged were put right/i);
    await expect(page.getByTestId("report-rectified-Left")).toContainText(/run in the paint/);
    await expect(page.getByTestId("report-rectified-Left")).toContainText(/Put right on/);
    await expect(page.getByTestId("report-warranty")).toContainText(/2-year workmanship warranty/);
  });
});
