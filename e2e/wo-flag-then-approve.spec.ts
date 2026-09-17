import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Flag, then "Happy with this" straight after, then sign (Tom, 17 Sep 2026):
 * "after flagging an item and then immediately ticking it as I'm happy, I am
 * unable to sign the job off."
 *
 * Reproduced: the flag moved the job to In progress and raised a rectify row;
 * the approve overwrote the flag but left the job there; wo_sign wrote the
 * signature and silently failed to close. Now the approve WITHDRAWS the flag
 * — the untouched rectify row goes, the job returns to walkthrough — and the
 * signature lands, or wo_sign refuses in words before writing anything.
 * Painter's phone (Mode A), driven in the painter's own session.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;

async function readyAtWalkthrough(f: LoopFixture) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await completePrep(db!, staff!, f.workOrderId);
  await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: f.workOrderId, p_to: "completion_prep" });
  expect(await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: f.workOrderId })).toMatch(/^ok:/);
}

test.describe("flag, change of mind, sign", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls"] },
      { heading: "Left", labels: ["Walls"] },
    ]);
    await readyAtWalkthrough(fixture);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("on the painter's phone: flag Left, tap Happy straight after, sign — the job closes", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);
    await page.getByTestId("walkthrough-bar-start").click();
    await page.waitForURL(/\/s\/[a-f0-9]{64}/, { timeout: 20_000 });

    await page.getByTestId("approve-Front").click();
    await expect(page.getByTestId("ok-Front")).toBeVisible();
    await page.getByTestId("flag-Left").click();
    await page.getByTestId("note-Left").fill("Is that a drip near the window?");
    await page.getByTestId("send-flag-Left").click();
    await expect(page.getByTestId("flagged-Left")).toBeVisible();

    // A change of mind: the flag is withdrawn, the job is back at walkthrough.
    await page.getByTestId("approve-Left").click();
    await expect(page.getByTestId("ok-Left")).toBeVisible();
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("walkthrough");
    const { data: rect } = await db!.from("wo_surfaces").select("id")
      .eq("work_order_id", fixture!.workOrderId).eq("rectification", true);
    expect((rect ?? []).length).toBe(0);

    await page.getByTestId("sign-name").fill("Melissa Hartley");
    await page.getByTestId("sign").click();
    await expect(page.getByTestId("signed")).toContainText("Signed off", { timeout: 15_000 });

    const { data: after } = await db!.from("work_orders").select("stage, status").eq("id", fixture!.workOrderId).single();
    expect((after as { stage: string; status: string }).stage).toBe("closed");
    expect((after as { status: string }).status).toBe("complete");

    const { data: so } = await db!.from("wo_signoff").select("signed_kind, areas").eq("work_order_id", fixture!.workOrderId).single();
    const s = so as { signed_kind: string; areas: Record<string, { approved_at?: string; flagged_at?: string; flag_withdrawn_at?: string; withdrawn_note?: string }> };
    expect(s.signed_kind).toBe("on_device");
    expect(s.areas.Left.approved_at).toBeTruthy();
    expect(s.areas.Left.flagged_at).toBeUndefined();
    expect(s.areas.Left.flag_withdrawn_at).toBeTruthy();
    expect(s.areas.Left.withdrawn_note).toContain("drip");
  });

  test("a signature on a job that is not at walkthrough is refused before anything is written", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const other = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
    try {
      await readyAtWalkthrough(other);
      const { data: so } = await db!.from("wo_signoff").select("customer_token").eq("work_order_id", other.workOrderId).single();
      const token = (so as { customer_token: string }).customer_token;
      expect(await rpcAs(staff!, "wo_walkthrough_area", { p_token: token, p_area: "Back", p_approve: true, p_note: "" })).toBe("ok:approved");
      // Remote sign is a fallback: the office opens it.
      await rpcAs(staff!, "wo_mark_client_unavailable", { p_work_order_id: other.workOrderId });
      // Staff pull the job back to In progress (the flag transition, staff are allowed).
      expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: other.workOrderId, p_to: "in_progress" })).toBe("ok:in_progress");

      const r = await rpcAs(staff!, "wo_sign", { p_token: token, p_name: "Melissa Hartley", p_kind: "remote", p_device: "web" });
      expect(r).toBe("error:not_at_walkthrough:in_progress");
      const { data: check } = await db!.from("wo_signoff").select("signed_at").eq("work_order_id", other.workOrderId).single();
      expect((check as { signed_at: string | null }).signed_at).toBeNull();
      const { data: w } = await db!.from("warranties").select("id").eq("work_order_id", other.workOrderId);
      expect((w ?? []).length).toBe(0);
    } finally {
      await destroyLoopFixture(db!, other);
    }
  });
});
