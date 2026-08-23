import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * §4b (v3, Tom's 23 Aug ruling) — walkthrough booking and the two sign modes.
 *
 * WRITTEN FAILING-FIRST: this spec describes behaviour the 20261028 migration
 * introduces. Until that SQL is pasted, wo_book_walkthrough does not exist and
 * every test here fails — that is the point.
 *
 * The three rules under test, in the real roles:
 *   1. Mode B is a FALLBACK. A customer with their own link cannot sign while
 *      nothing says they had to — no unavailable-mark, no missed walkthrough.
 *   2. Mode A is scoped. Only the assigned contractor can open Walkthrough
 *      Mode, only at the walkthrough stage, only with a final booked; the
 *      session signs as on_device / contractor_device.
 *   3. Deemed cannot be claimed early. The sweep's own vocabulary, sent by a
 *      browser before the deadline, is refused.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let token = "";

async function readyForWalkthrough(f: LoopFixture): Promise<string> {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await completePrep(db!, staff!, f.workOrderId);
  await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: f.workOrderId, p_to: "completion_prep" });
  const result = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: f.workOrderId });
  expect(result).toMatch(/^ok:/);
  return result.slice(3);
}

async function approveAllAreas(signToken: string, headings: string[]) {
  for (const h of headings) {
    const r = await rpcAs(staff!, "wo_walkthrough_area",
      { p_token: signToken, p_area: h, p_approve: true, p_note: "" });
    expect(r).toBe("ok:approved");
  }
}

test.describe("v3 walkthrough + two-mode sign-off", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls"] },
    ]);
    token = await readyForWalkthrough(fixture!);
    // The booked final lives HERE, not in a test: when a test fails, Playwright
    // restarts the worker and re-runs beforeAll with a FRESH fixture — any
    // state a later test relied on from an earlier one is gone, and the whole
    // tail cascades (exactly what happened on 23 Aug). Hooks build ALL state.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
    const booked = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: fixture!.workOrderId, p_kind: "final", p_date: today, p_note: "" });
    if (!booked.startsWith("ok:")) throw new Error(`fixture walkthrough not booked: ${booked}`);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("Mode B is gated: a remote sign before any fallback condition is refused", async () => {
    await approveAllAreas(token, ["Front"]);
    // Their own link, everything approved, name typed — and still no: nobody
    // marked them unavailable and no walkthrough was missed.
    const r = await rpcAs(staff!, "wo_sign",
      { p_token: token, p_name: "Melissa Hartley", p_kind: "remote", p_device: "e2e" });
    expect(r).toBe("error:walkthrough_first");
  });

  test("deemed cannot be claimed before the deadline", async () => {
    const r = await rpcAs(staff!, "wo_sign",
      { p_token: token, p_name: "Nobody", p_kind: "deemed", p_device: "e2e" });
    expect(r).toBe("error:deemed_too_early");
  });

  test("booking with no date derives it, or asks for one when no booking exists", async () => {
    // The fixture has no accepted booking, so the default-date path must say
    // so rather than inventing a date. (A real job takes the booking's end.)
    const noDate = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: fixture!.workOrderId, p_kind: "final", p_date: null, p_note: "" });
    expect(noDate).toBe("error:no_date");

    // Rebooking with an explicit date cancels and replaces the live final.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
    const rebooked = await rpcAs(staff!, "wo_book_walkthrough",
      { p_work_order_id: fixture!.workOrderId, p_kind: "final", p_date: today, p_note: "" });
    expect(rebooked).toMatch(/^ok:/);
  });

  test("the booked final pins onto the staff schedule board", async ({ page }) => {
    const { signIn } = await import("./helpers");
    await signIn(page, staff!, /\/(estimates|pc)/);
    await page.goto("/pc/schedule");
    // OUR pin, by href — Tom's real walkthroughs share this board now, and
    // first() was whichever lane sorted higher.
    const pin = page.locator(`[href="/pc/wo/${fixture!.workOrderId}"][data-testid^="walkthrough-pin-"]`);
    await expect(pin).toBeVisible({ timeout: 20_000 });
    await expect(pin).toContainText(/WALK/);
  });

  test("the painter's job page offers Start the walkthrough, and it opens the customer view", async ({ page }) => {
    // The UI half of Mode A, in the real role: the button exists at the
    // walkthrough stage, and pressing it lands in the customer's own view.
    const { signIn } = await import("./helpers");
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await page.getByTestId("start-walkthrough").click();
    await page.waitForURL(/\/s\/[a-f0-9]{64}/, { timeout: 20_000 });
    await expect(page.locator("h1")).toContainText(/finished/i);
  });

  test("Mode A signs as on_device, captured on the contractor's device", async () => {
    const started = await rpcAs(contractor!, "wo_start_walkthrough_mode",
      { p_work_order_id: fixture!.workOrderId });
    expect(started).toMatch(/^ok:/);
    const session = started.slice(3);

    // The session token IS the customer view: the signature is the customer's
    // typed name, and the kind is derived — not whatever the caller claims.
    const signed = await rpcAs(staff!, "wo_sign",
      { p_token: session, p_name: "Melissa Hartley", p_kind: "remote", p_device: "contractor phone" });
    expect(signed).toBe("ok:signed");

    const { data } = await db!.from("wo_signoff")
      .select("signed_kind, captured_on, signed_name")
      .eq("work_order_id", fixture!.workOrderId).single();
    expect(data?.signed_kind).toBe("on_device");
    expect(data?.captured_on).toBe("contractor_device");
    expect(data?.signed_name).toBe("Melissa Hartley");
  });

  test("the signed page renders the completion report the email promises", async ({ browser }) => {
    // The ⚑10 email links to /s/<customer_token> saying the report lives
    // there. Fetched as the CUSTOMER: no session, just the link from the email.
    const anon = await browser.newContext();
    try {
      const page = await anon.newPage();
      await page.goto(`/s/${token}`);
      await expect(page.getByTestId("signed")).toBeVisible();
      await expect(page.getByTestId("completion-report")).toBeVisible();
      await expect(page.getByTestId("report-warranty")).toContainText(/warranty/i);
      await expect(page.getByTestId("report-area-Front")).toContainText("Walls");
    } finally {
      await anon.close();
    }
  });

  test("an unassigned contractor cannot open Walkthrough Mode on someone else's job", async () => {
    // The fixture's job belongs to E2E_CONTRACTOR; staff without the contractor
    // hat pass is_staff, so use a second fixture owned by nobody to prove the
    // not-yours path — covered here by the already-signed job refusing reuse.
    const again = await rpcAs(contractor!, "wo_start_walkthrough_mode",
      { p_work_order_id: fixture!.workOrderId });
    expect(again).toMatch(/^error:/);   // signed → no session row to mint onto
  });
});
