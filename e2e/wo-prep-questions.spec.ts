import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 23 Aug — the finishing-up list becomes questions, and a passed quality
 * check actually moves the job on:
 *
 *   · seven items: ticks, two yes/no (rubbish → office prompt; equipment →
 *     needs the list), a notes box for the customer;
 *   · a question cannot be ticked, it must be answered; the office marks a
 *     collection organised;
 *   · the LAST pass on the staff screen sends the pack — the job is at
 *     Walkthrough on both portals without anyone pressing "send";
 *   · the painter may send a passed job on themselves;
 *   · the customer reads the painter's note on the sign-off page.
 *
 * Needs migration 20261103 live. The fixture contractor is "new", so checks
 * are scheduled on finish.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let rpcFixture: LoopFixture | null = null;   // RPC-level rules
let uiFixture: LoopFixture | null = null;    // staff passes on screen → walkthrough
let painterFixture: LoopFixture | null = null; // the painter sends a passed job on

async function allDone(f: LoopFixture) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
}

async function passEveryCheck(workOrderId: string, leaveOne = false): Promise<string | null> {
  const { data: checks } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", workOrderId);
  const list = (checks ?? []) as { id: string }[];
  let left: string | null = null;
  for (const [i, c] of list.entries()) {
    const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
    for (const item of (items ?? []) as { id: string }[]) {
      await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
    }
    if (leaveOne && i === list.length - 1) { left = c.id; continue; }
    expect(await rpcAs(staff!, "wo_record_qa",
      { p_check_id: c.id, p_result: "pass", p_notes: "e2e", p_rectify: [] })).toMatch(/^ok/);
  }
  return left;
}

test.describe("prep questions + pass → walkthrough", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    rpcFixture = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    uiFixture = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    painterFixture = await createLoopFixture(db!, contractorId!, [{ heading: "Side", labels: ["Walls"] }]);
    for (const f of [rpcFixture!, uiFixture!, painterFixture!]) await allDone(f);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, rpcFixture);
    await destroyLoopFixture(db!, uiFixture);
    await destroyLoopFixture(db!, painterFixture);
  });

  test("the list is seven items: ticks, two questions, a notes box", async () => {
    expect(await rpcAs(contractor!, "wo_seed_prep_checklist", { p_work_order_id: rpcFixture!.workOrderId }))
      .toMatch(/^ok:/);
    const { data } = await db!.from("wo_checklist_items")
      .select("item_key, kind, required, label").eq("work_order_id", rpcFixture!.workOrderId)
      .eq("phase", "completion_prep").order("sort");
    const rows = (data ?? []) as { item_key: string; kind: string; required: boolean; label: string }[];
    expect(rows.map((r) => r.item_key)).toEqual([
      "touch_up", "site_clean", "rubbish", "equipment", "final_photos", "scope_complete", "customer_note",
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["tick", "tick", "yes_no", "yes_no", "tick", "tick", "note"]);
    expect(rows.find((r) => r.item_key === "customer_note")!.required).toBe(false);
    expect(rows.find((r) => r.item_key === "scope_complete")!.label).toBe("All work completed to the level required");
    // Seeding again adds nothing.
    expect(await rpcAs(staff!, "wo_seed_prep_checklist", { p_work_order_id: rpcFixture!.workOrderId })).toBe("ok:0");
  });

  test("a question is answered, not ticked; equipment yes needs the list; rubbish yes prompts the office", async () => {
    const { data } = await db!.from("wo_checklist_items")
      .select("id, item_key").eq("work_order_id", rpcFixture!.workOrderId).eq("phase", "completion_prep");
    const byKey = new Map(((data ?? []) as { id: string; item_key: string }[]).map((r) => [r.item_key, r.id]));

    expect(await rpcAs(contractor!, "wo_tick_checklist_item", { p_item_id: byKey.get("rubbish")!, p_done: true }))
      .toBe("error:answer_required");
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: byKey.get("touch_up")!, p_answer: "yes", p_note: "" }))
      .toBe("error:not_a_question");
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: byKey.get("equipment")!, p_answer: "yes", p_note: "" }))
      .toBe("error:list_required");
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: byKey.get("equipment")!, p_answer: "yes", p_note: "2 ladders, the sprayer" }))
      .toBe("ok:yes");
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: byKey.get("rubbish")!, p_answer: "yes", p_note: "" }))
      .toBe("ok:yes");
    expect(await rpcAs(contractor!, "wo_answer_checklist_item", { p_item_id: byKey.get("customer_note")!, p_answer: null, p_note: "Keep the windows closed tonight." }))
      .toBe("ok:noted");

    // Both yeses are waiting on the office.
    const { data: open } = await db!.from("wo_checklist_items").select("item_key, answer_note")
      .eq("work_order_id", rpcFixture!.workOrderId).eq("answer", "yes").is("handled_at", null);
    expect(((open ?? []) as { item_key: string }[]).map((r) => r.item_key).sort()).toEqual(["equipment", "rubbish"]);

    // Only staff can say it's organised.
    expect(await rpcAs(contractor!, "wo_handle_collection", { p_item_id: byKey.get("rubbish")! })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_handle_collection", { p_item_id: byKey.get("rubbish")! })).toBe("ok");
    const { data: after } = await db!.from("wo_checklist_items").select("handled_at")
      .eq("id", byKey.get("rubbish")!).maybeSingle();
    expect((after as { handled_at: string | null }).handled_at).not.toBeNull();

    // The notes box never gates; the required ticks do.
    const r = await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: rpcFixture!.workOrderId });
    expect(r).toMatch(/^ok:completion_prep/);
    const blocked = await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: rpcFixture!.workOrderId });
    expect(blocked).toMatch(/^error:gate:.*completion item/);
    for (const key of ["touch_up", "site_clean", "final_photos", "scope_complete"]) {
      expect(await rpcAs(contractor!, "wo_tick_checklist_item", { p_item_id: byKey.get(key)!, p_done: true })).toBe("ok:done");
    }
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: rpcFixture!.workOrderId })).toBe("ok:qa");
  });

  test("the painter's note reaches the customer's sign-off page", async ({ page }) => {
    // Pass the checks and send the pack (RPC) — then read the page as the customer.
    await passEveryCheck(rpcFixture!.workOrderId);
    const delivered = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: rpcFixture!.workOrderId });
    expect(delivered).toMatch(/^ok:/);
    const token = delivered.slice(3);
    await page.goto(`/s/${token}`);
    await expect(page.getByTestId("painter-note")).toContainText("Keep the windows closed tonight.", { timeout: 15_000 });
  });

  test("staff: the LAST pass on screen sends the pack — the job is at Walkthrough on both portals", async ({ page }) => {
    await completePrep(db!, staff!, uiFixture!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: uiFixture!.workOrderId }))
      .toBe("ok:completion_prep:qa_pending");
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: uiFixture!.workOrderId })).toBe("ok:qa");
    const lastCheck = await passEveryCheck(uiFixture!.workOrderId, true);
    expect(lastCheck).not.toBeNull();

    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${uiFixture!.workOrderId}`);
    await expect(page.getByTestId(`qa-${lastCheck}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`qa-pass-${lastCheck}`).click();
    await expect(page.getByTestId(`qa-result-${lastCheck}`)).toContainText("PASS", { timeout: 15_000 });
    await expect(page.getByTestId(`qa-msg-${lastCheck}`)).toContainText(/walkthrough/i);

    // The stage moved — the database says so, and the page re-rendered around it.
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", uiFixture!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("walkthrough");
    const { data: so } = await db!.from("wo_signoff").select("customer_token, evidence_pack_sent_at")
      .eq("work_order_id", uiFixture!.workOrderId).maybeSingle();
    expect((so as { evidence_pack_sent_at: string | null }).evidence_pack_sent_at).not.toBeNull();
    await expect(page.getByTestId("stage-advance")).toContainText(/Walkthrough/, { timeout: 15_000 });
  });

  test("…and the painter sees the walkthrough step, not the quality-check notice", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${uiFixture!.workOrderId}`);
    await expect(page.getByTestId("walkthrough-start")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("qa-notice")).toHaveCount(0);
  });

  test("the pass itself moves the job — the painter sees the walkthrough, never a send button", async ({ page }) => {
    await completePrep(db!, staff!, painterFixture!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: painterFixture!.workOrderId }))
      .toBe("ok:completion_prep:qa_pending");
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: painterFixture!.workOrderId })).toBe("ok:qa");

    // Passed by RPC, no screen involved: wo_record_qa routes it on the last pass.
    const { data: checks } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", painterFixture!.workOrderId);
    const list = (checks ?? []) as { id: string }[];
    for (const [i, c] of list.entries()) {
      const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
      for (const item of (items ?? []) as { id: string }[]) {
        await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
      }
      const r = await rpcAs(staff!, "wo_record_qa", { p_check_id: c.id, p_result: "pass", p_notes: "e2e", p_rectify: [] });
      // Fixture jobs have no QA photos, so ":thin_record" may trail either answer.
      expect(r).toMatch(i === list.length - 1 ? /^ok:pass:walkthrough/ : /^ok:pass(:thin_record)?$/);
    }
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", painterFixture!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("walkthrough");
    const { data: so } = await db!.from("wo_signoff").select("evidence_pack_sent_at")
      .eq("work_order_id", painterFixture!.workOrderId).maybeSingle();
    expect((so as { evidence_pack_sent_at: string | null }).evidence_pack_sent_at).not.toBeNull();

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${painterFixture!.workOrderId}`);
    await expect(page.getByTestId("walkthrough-start")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("send-pack")).toHaveCount(0);
    await expect(page.getByTestId("qa-passed")).toHaveCount(0);
  });

  test("a job left passed-at-qa by any other path moves the moment the painter looks", async ({ page }) => {
    // Park a job at qa with every check passed WITHOUT going through
    // wo_record_qa (a straight row update — the shape of a pre-routing job).
    const cid = await contractorIdForEmail(db!, contractor!.email);
    const parked = await createLoopFixture(db!, cid!, [{ heading: "Rear", labels: ["Walls"] }]);
    try {
      await allDone(parked);
      await completePrep(db!, staff!, parked.workOrderId);
      expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: parked.workOrderId }))
        .toBe("ok:completion_prep:qa_pending");
      expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: parked.workOrderId })).toBe("ok:qa");
      await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", parked.workOrderId);
      const { data: before } = await db!.from("work_orders").select("stage").eq("id", parked.workOrderId).maybeSingle();
      expect((before as { stage: string }).stage).toBe("qa");

      await signIn(page, contractor!, /\/portal/);
      await page.goto(`/portal/jobs/${parked.workOrderId}`);
      await expect(page.getByTestId("walkthrough-start")).toBeVisible({ timeout: 15_000 });
      const { data: after } = await db!.from("work_orders").select("stage").eq("id", parked.workOrderId).maybeSingle();
      expect((after as { stage: string }).stage).toBe("walkthrough");
    } finally {
      await destroyLoopFixture(db!, parked);
    }
  });
});
