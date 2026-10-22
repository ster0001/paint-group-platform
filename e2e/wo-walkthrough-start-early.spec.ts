import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture, photosIn, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 23 Oct 2026: "confirm the walkthrough is working for both contractor and in the pc
 * command to be able to start walk through — even if quality check isn't passed". Migration
 * 20270295: wo_start_walkthrough_mode takes a job from in_progress (office only), from
 * completion_prep (both, once the prep list is ticked) or from qa, delivers the pack and opens
 * the session. The PC card shows Walk through on this device from In progress on.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let early: LoopFixture | null = null;
let prep: LoopFixture | null = null;
const stageOf = async (id: string) => (await db!.from("work_orders").select("stage").eq("id", id).single()).data!.stage as string;

test.describe.configure({ mode: "serial" });

test.describe("the walkthrough starts before the quality check, from both sides", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    early = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);
    prep = await createLoopFixture(db!, contractorId, [{ heading: "Back", labels: ["Walls"] }]);
    for (const f of [early, prep]) expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: f.workOrderId, p_required: true })).toMatch(/^ok/);
    expect(await stageOf(early.workOrderId)).toBe("in_progress");
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, early); await destroyLoopFixture(db!, prep); });

  test("in progress: the painter is told to tick the surfaces first; the office starts it and the pack goes out", async () => {
    expect(await rpcAs(contractor!, "wo_start_walkthrough_mode", { p_work_order_id: early!.workOrderId })).toBe("error:surfaces_first");
    const r = await rpcAs(staff!, "wo_start_walkthrough_mode", { p_work_order_id: early!.workOrderId });
    expect(r).toMatch(/^ok:/);
    expect(await stageOf(early!.workOrderId)).toBe("walkthrough");
    const { data: s } = await db!.from("wo_signoff").select("customer_token, evidence_pack_sent_at, walkthrough_session_token").eq("work_order_id", early!.workOrderId).single();
    const row = s as { customer_token: string | null; evidence_pack_sent_at: string | null; walkthrough_session_token: string | null };
    expect(row.customer_token, "the customer's sign-off link exists").toBeTruthy();
    expect(row.evidence_pack_sent_at, "the pack went").toBeTruthy();
    expect(row.walkthrough_session_token).toBe(r.slice(3));
    const { data: ev } = await db!.from("wo_events").select("type, meta").eq("work_order_id", early!.workOrderId).eq("type", "walkthrough_before_qa");
    expect(((ev ?? []) as { meta: { from_stage?: string } }[])[0]?.meta?.from_stage).toBe("in_progress");
  });

  test("finishing up: the painter is refused in words until the prep list is ticked, then starts it", async () => {
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", prep!.workOrderId);
    await photosIn(db!, prep!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: prep!.workOrderId })).toMatch(/^ok/);
    expect(await stageOf(prep!.workOrderId)).toBe("completion_prep");
    await rpcAs(contractor!, "wo_seed_prep_checklist", { p_work_order_id: prep!.workOrderId });
    expect(await rpcAs(contractor!, "wo_start_walkthrough_mode", { p_work_order_id: prep!.workOrderId })).toMatch(/^error:gate:.*completion item/);
    await completePrep(db!, contractor!, prep!.workOrderId);
    expect(await rpcAs(contractor!, "wo_start_walkthrough_mode", { p_work_order_id: prep!.workOrderId })).toMatch(/^ok:/);
    expect(await stageOf(prep!.workOrderId)).toBe("walkthrough");
  });

  test("in the browser: the PC card offers Walk through on this device while the job is in progress", async ({ page }) => {
    const contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    const live = await createLoopFixture(db!, contractorId, [{ heading: "Side", labels: ["Walls"] }]);
    try {
      await signIn(page, staff!, /\/(home|estimates)/);
      await page.goto(`/pc/wo/${live.workOrderId}`);
      await expect(page.getByTestId("staff-walkthrough")).toBeVisible({ timeout: 30_000 });
      // The card opens the customer's walkthrough in a new tab and says so on the card.
      const popup = page.context().waitForEvent("page", { timeout: 30_000 }).catch(() => null);
      await page.getByTestId("staff-walkthrough").click();
      await expect(page.getByText("Walkthrough open on this device.")).toBeVisible({ timeout: 30_000 });
      const opened = await popup;
      if (opened) { await expect(opened).toHaveURL(/\/s\//); await opened.close(); }
      expect(await stageOf(live.workOrderId)).toBe("walkthrough");
    } finally {
      await destroyLoopFixture(db!, live);
    }
  });
});
