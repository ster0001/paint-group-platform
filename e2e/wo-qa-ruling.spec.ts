import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * The QA ruling (Tom, 23 Aug), failing-first until 20261030 is pasted:
 *
 *   · the painter finishes their own job — the SERVER routes it to quality
 *     check (new/flagged contractor) or completion prep, never their choice;
 *   · the final walkthrough cannot be booked while a check is unpassed;
 *   · pass the checks and the booking opens.
 *
 * The fixture contractor is E2E_CONTRACTOR, who is "new" (fixture jobs are
 * destroyed after every run, so their closed count stays near zero).
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let uiFixture: LoopFixture | null = null;

async function allDone(f: LoopFixture) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
}

test.describe("QA ruling — finish, route, gate", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    uiFixture = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    await allDone(fixture!);
    await allDone(uiFixture!);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    await destroyLoopFixture(db!, uiFixture);
  });

  test("the painter finishes: prep pops up, with the QA heads-up for a new contractor", async () => {
    const r = await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: fixture!.workOrderId });
    expect(r).toBe("ok:completion_prep:qa_pending");

    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id, result").eq("work_order_id", fixture!.workOrderId);
    expect((checks ?? []).length).toBeGreaterThan(0);

    // The notice event the portal banner and any future comms hang off.
    const { data: ev } = await db!.from("wo_events")
      .select("id").eq("work_order_id", fixture!.workOrderId).eq("type", "qa_pending_notice");
    expect((ev ?? []).length).toBe(1);
  });

  test("prep confirmed → the server routes to quality check, not the painter", async () => {
    // Entering prep seeded the checklist (stage trigger); tick it complete.
    await completePrep(db!, staff!, fixture!.workOrderId);
    const r = await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: fixture!.workOrderId });
    expect(r).toBe("ok:qa");
  });

  test("no final sign-off date while a check is unpassed", async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
    const r = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: fixture!.workOrderId, p_kind: "final", p_date: today, p_note: "" });
    expect(r).toBe("error:qa_first");
    // A pre-walkthrough is still allowed — the gate is on the SIGN-OFF date.
    const pre = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: fixture!.workOrderId, p_kind: "pre", p_date: today, p_note: "" });
    expect(pre).toMatch(/^ok:/);
  });

  test("passing the checks opens the booking", async () => {
    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id").eq("work_order_id", fixture!.workOrderId);
    for (const c of (checks ?? []) as { id: string }[]) {
      const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
      for (const item of (items ?? []) as { id: string }[]) {
        const t = await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
        expect(t).toMatch(/^ok/);
      }
      const pass = await rpcAs(staff!, "wo_record_qa",
        { p_check_id: c.id, p_result: "pass", p_notes: "e2e ruling", p_rectify: [] });
      expect(pass).toMatch(/^ok/);
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
    const r = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: fixture!.workOrderId, p_kind: "final", p_date: today, p_note: "" });
    expect(r).toMatch(/^ok:/);

    // And with the checks passed, the pack can go out from the qa stage.
    const delivered = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: fixture!.workOrderId });
    expect(delivered).toMatch(/^ok:/);
  });

  test("the painter's screen: ticks done → finishing-up list, one press routes it", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${uiFixture!.workOrderId}`);

    // The finishing-up list is part of the tick-off step — visible at
    // In progress the moment every surface is done, no stage change shown.
    await expect(page.getByTestId("prep-checklist")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("finish-job")).toBeVisible();

    // Unticked list → the press is refused in the gate's words.
    await page.getByTestId("finish-job").click();
    await expect(page.getByTestId("finish-msg")).toContainText(/still to tick/i, { timeout: 15_000 });

    // Tick it (the office can too), press again → routed to quality check.
    await completePrep(db!, staff!, uiFixture!.workOrderId);
    await page.getByTestId("finish-job").click();
    await expect(page.getByTestId("finish-msg")).toContainText(/quality check/i, { timeout: 15_000 });
  });
});
