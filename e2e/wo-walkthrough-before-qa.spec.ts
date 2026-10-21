import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  photosIn, rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 21 Oct 2026: "allow to book the final walk through, even if a quality
 * check is required — if the quality check hasn't passed, please still allow
 * the contractor to start the walk through in the app."
 *
 * Until 20270284 a job with a check on it finished to the Quality check stage
 * and stayed there: the office could not book a FIRST final (error:qa_first,
 * 20270241 freed only a rebook), and the painter's page showed a notice with
 * no walkthrough button, the pack held by wo_gate_blocked ("1 quality check
 * still open"). Now:
 *
 *   · the final is booked whenever the office agrees it with the client;
 *   · the painter's job page at Quality check carries the pinned bar and the
 *     Walkthrough & sign-off card, and one press opens the customer's view —
 *     the server delivers the pack on the way and records walkthrough_before_qa;
 *   · the check stays OPEN and the office still logs it in its own time.
 *
 * The finish route itself is unchanged (still ok:qa — wo-qa-ruling keeps that),
 * and a PASSED check is still the office's sign-off (wo-qa-overrides).
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let checkId = "";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });

async function stageNow(): Promise<string> {
  const { data } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
  return (data as { stage: string }).stage;
}

async function openChecks(): Promise<number> {
  const { data, error } = await db!.rpc("wo_qa_open_count", { p_work_order_id: job!.workOrderId });
  if (error) throw new Error(`wo_qa_open_count: ${error.message}`);
  return Number(data);
}

test.describe.configure({ mode: "serial" });

test.describe("the walkthrough goes ahead before the quality check", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    // The office wants this job checked — who gets a check is not under test.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: job.workOrderId, p_required: true }))
      .toMatch(/^ok/);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job.workOrderId);
    await photosIn(db!, job.workOrderId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("1 · the painter finishes — the job still parks at Quality check with the check open", async () => {
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: job!.workOrderId }))
      .toBe("ok:completion_prep:qa_pending");
    await completePrep(db!, contractor!, job!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: job!.workOrderId }))
      .toBe("ok:qa");
    expect(await stageNow()).toBe("qa");
    expect(await openChecks()).toBe(1);

    const { data: checks } = await db!.from("wo_qa_checks")
      .select("id, result").eq("work_order_id", job!.workOrderId);
    const rows = (checks ?? []) as { id: string; result: string | null }[];
    expect(rows.length).toBe(1);
    expect(rows[0].result).toBeNull();
    checkId = rows[0].id;
  });

  test("2 · the office books the FIRST final while the check is open — no more qa_first", async () => {
    const { data: before } = await db!.from("wo_walkthroughs").select("id").eq("work_order_id", job!.workOrderId).eq("kind", "final");
    expect((before ?? []).length, "a job that never had a final date").toBe(0);

    const r = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: job!.workOrderId, p_kind: "final", p_date: today(), p_note: "", p_time: "15:00" });
    expect(r).toMatch(/^ok:/);

    const { data: after } = await db!.from("wo_walkthroughs")
      .select("status, scheduled_date").eq("work_order_id", job!.workOrderId).eq("kind", "final");
    expect(after).toEqual([{ status: "booked", scheduled_date: today() }]);
    // Booking the final does not touch the check: still one, still open.
    expect(await openChecks()).toBe(1);
  });

  test("3 · the painter's page at Quality check offers the walkthrough, and one press opens it", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${job!.workOrderId}`);

    const notice = page.getByTestId("qa-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText(/doesn't hold you up/i);

    const bar = page.getByTestId("walkthrough-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("data-phase", "walkthrough");
    await expect(bar).toHaveAttribute("data-qa-open", "1");
    await expect(bar).toContainText(/quality check is still to come/i);
    await expect(page.getByTestId("walkthrough-start")).toBeVisible();
    await expect(page.getByTestId("walkthrough-start")).toContainText(/Final walkthrough booked for/);

    await bar.getByTestId("walkthrough-bar-start").click();
    await page.waitForURL(/\/s\/[a-f0-9]{64}/, { timeout: 20_000 });
    await expect(page.locator("h1")).toContainText(/finished/i);

    // The server delivered the pack on the way: stage walkthrough, a
    // customer token minted, the check untouched and still open.
    await expect.poll(stageNow, { timeout: 15_000 }).toBe("walkthrough");
    const { data: so } = await db!.from("wo_signoff").select("customer_token, evidence_pack_sent_at")
      .eq("work_order_id", job!.workOrderId).single();
    expect((so as { customer_token: string | null }).customer_token).toBeTruthy();
    expect((so as { evidence_pack_sent_at: string | null }).evidence_pack_sent_at).toBeTruthy();
    expect(await openChecks()).toBe(1);

    const { data: ev } = await db!.from("wo_events")
      .select("type, from_stage, to_stage").eq("work_order_id", job!.workOrderId).order("created_at");
    const events = (ev ?? []) as { type: string; from_stage: string | null; to_stage: string | null }[];
    expect(events.map((e) => e.type)).toContain("walkthrough_before_qa");
    expect(events.map((e) => e.type)).toContain("walkthrough_mode_started");
    const moves = events.filter((e) => e.type === "stage_changed").map((e) => `${e.from_stage}>${e.to_stage}`);
    expect(moves[moves.length - 1]).toBe("qa>walkthrough");
  });

  test("4 · the check is still the office's to log — a pass on a job already walking is recorded, nothing re-routed", async () => {
    const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", checkId);
    for (const item of (items ?? []) as { id: string }[]) {
      expect(await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true })).toMatch(/^ok/);
    }
    const pass = await rpcAs(staff!, "wo_record_qa",
      { p_check_id: checkId, p_result: "pass", p_notes: "e2e — checked while the customer walked", p_rectify: [] });
    // Not ok:pass:walkthrough — the job is already there; the route is a no-op.
    expect(pass).toMatch(/^ok:pass(:thin_record)?$/);
    expect(await openChecks()).toBe(0);
    expect(await stageNow()).toBe("walkthrough");
  });

  test("5 · the gate in its own words: an open check holds closed-without-walkthrough, not the walkthrough", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const fresh = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    try {
      expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: fresh.workOrderId, p_required: true })).toMatch(/^ok/);
      await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", fresh.workOrderId);
      await photosIn(db!, fresh.workOrderId);
      expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: fresh.workOrderId })).toBe("ok:completion_prep:qa_pending");
      await completePrep(db!, contractor!, fresh.workOrderId);
      expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: fresh.workOrderId })).toBe("ok:qa");

      // Straight to closed from qa (the no-walkthrough path) still waits for the check.
      expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fresh.workOrderId, p_to: "closed" }))
        .toBe("error:gate:1 quality check still open");
      // The pack to the walkthrough does not.
      expect(await rpcAs(contractor!, "wo_deliver_evidence_pack", { p_work_order_id: fresh.workOrderId })).toMatch(/^ok:/);
      const { data } = await db!.from("work_orders").select("stage").eq("id", fresh.workOrderId).single();
      expect((data as { stage: string }).stage).toBe("walkthrough");
    } finally {
      await destroyLoopFixture(db!, fresh);
    }
  });
});
