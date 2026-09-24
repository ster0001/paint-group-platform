import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 24 Sep 2026 — the quality-check overrides and the office's sign-off
 * (migration 20270197):
 *
 *   · "Quality check not required" on ONE job — the office overrides a new
 *     contractor's cadence; a job parked at Quality check moves on;
 *   · a job that WENT THROUGH a quality check is signed off by the office,
 *     not the customer: no nudges, one button on the PC job page;
 *   · "Walkthrough not required" pressed once the job is already at the
 *     walkthrough stage closes it from there (used to strand it).
 *
 * Fixtures only through the service client; every decision is the RPC's or
 * the screen's. Anything created here is destroyed in afterAll.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let waived: LoopFixture | null = null;
let parked: LoopFixture | null = null;
let checked: LoopFixture | null = null;
let noWalk: LoopFixture | null = null;

const stageOf = async (id: string) => {
  const { data } = await db!.from("work_orders").select("stage, qa_required, qa_waived").eq("id", id).single();
  return data as { stage: string; qa_required: boolean; qa_waived: boolean };
};
const openChecks = async (id: string) => {
  const { data } = await db!.from("wo_qa_checks").select("id, kind, result").eq("work_order_id", id);
  return (data ?? []) as { id: string; kind: string; result: string | null }[];
};

/** Every surface done and the finishing-up list answered — the two gates before the check/pack. */
async function finishTheWork(f: LoopFixture) {
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await completePrep(db!, staff!, f.workOrderId);
}

test.describe.configure({ mode: "serial" });

test.describe("quality-check overrides and the office's sign-off", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    waived = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    parked = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    checked = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls", "Windows"] }]);
    noWalk = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);
  });

  test.afterAll(async () => {
    for (const f of [waived, parked, checked, noWalk]) await destroyLoopFixture(db!, f);
  });

  test("waiving the check takes the due checks off the books and stops scheduling; flagging it on clears the waiver", async () => {
    const id = waived!.workOrderId;
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: id, p_required: true })).toBe("ok:true");
    expect((await openChecks(id)).length).toBeGreaterThan(0);

    expect(await rpcAs(staff!, "wo_set_qa_waived", { p_work_order_id: id, p_waived: true })).toBe("ok:waived");
    const after = await stageOf(id);
    expect(after.qa_waived).toBe(true);
    expect(after.qa_required).toBe(false);
    expect((await openChecks(id)).filter((c) => c.result === null)).toEqual([]);
    // The cadence would schedule for a new contractor — the waiver wins.
    expect(await rpcAs(staff!, "wo_schedule_qa", { p_work_order_id: id })).toBe("ok:0");

    // Ticking "required" again is the office asking for a check: waiver gone, check back.
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: id, p_required: true })).toBe("ok:true");
    const again = await stageOf(id);
    expect(again.qa_waived).toBe(false);
    expect((await openChecks(id)).some((c) => c.result === null)).toBe(true);

    const { data: ev } = await db!.from("wo_events").select("type").eq("work_order_id", id).eq("type", "qa_waived");
    expect((ev ?? []).length).toBe(1);
  });

  test("a job parked at Quality check moves on the moment the check is waived", async () => {
    const id = parked!.workOrderId;
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: id, p_required: true })).toBe("ok:true");
    await finishTheWork(parked!);
    expect(await rpcAs(staff!, "wo_contractor_finish", { p_work_order_id: id })).toBe("ok:completion_prep:qa_pending");
    expect(await rpcAs(staff!, "wo_contractor_confirm_prep", { p_work_order_id: id })).toBe("ok:qa");
    expect((await stageOf(id)).stage).toBe("qa");

    expect(await rpcAs(staff!, "wo_set_qa_waived", { p_work_order_id: id, p_waived: true })).toBe("ok:waived:walkthrough");
    expect((await stageOf(id)).stage).toBe("walkthrough");
    const { data: so } = await db!.from("wo_signoff").select("customer_token").eq("work_order_id", id).maybeSingle();
    expect((so as { customer_token: string | null } | null)?.customer_token).toBeTruthy();
    // No pass on record — this one is the CUSTOMER's to sign, as before.
    expect(await rpcAsJson<boolean>(staff!, "wo_staff_signs_off", { p_work_order_id: id })).toBe(false);
  });

  test("a quality-checked job is the office's to sign off — no customer nudges, one button on the PC page", async ({ page }) => {
    const id = checked!.workOrderId;
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: id, p_required: true })).toBe("ok:true");
    await finishTheWork(checked!);
    expect(await rpcAs(staff!, "wo_contractor_finish", { p_work_order_id: id })).toBe("ok:completion_prep:qa_pending");
    expect(await rpcAs(staff!, "wo_contractor_confirm_prep", { p_work_order_id: id })).toBe("ok:qa");

    // Pass every open check the way the inspector would: every standard looked at.
    for (const c of (await openChecks(id)).filter((c) => c.result === null)) {
      const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
      for (const i of (items ?? []) as { id: string }[]) {
        expect(await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: i.id, p_done: true })).toBe("ok:done");
      }
      const r = await rpcAs(staff!, "wo_record_qa", { p_check_id: c.id, p_result: "pass", p_notes: "Good.", p_rectify: [] });
      expect(r).toMatch(/^ok:pass/);
    }
    expect((await stageOf(id)).stage).toBe("walkthrough");
    expect(await rpcAsJson<boolean>(staff!, "wo_staff_signs_off", { p_work_order_id: id })).toBe(true);

    // The nudge ladder leaves this job alone: nothing is asked of the customer.
    await rpcAsJson(staff!, "wo_signoff_sweep", {});
    const { data: nudges } = await db!.from("wo_events").select("id").eq("work_order_id", id).eq("type", "signoff_nudge");
    expect((nudges ?? []).length).toBe(0);

    // The PC job page: the office's button, not the customer-signature controls.
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${id}`);
    await expect(page.getByTestId("staff-complete")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("staff-signoff")).toHaveCount(0);
    await expect(page.getByTestId("mark-unavailable")).toHaveCount(0);
    await expect(page.getByTestId("advance-closed")).toContainText(/quality check passed/i);
    await page.getByTestId("staff-complete-note").fill("Checked on site — all standards met.");
    await page.getByTestId("staff-complete-sign").click();
    await expect(page.getByTestId("walkthrough-msg")).toContainText(/Signed off and closed/, { timeout: 30_000 });

    expect((await stageOf(id)).stage).toBe("closed");
    const { data: so } = await db!.from("wo_signoff").select("signed_at, signed_name, captured_on").eq("work_order_id", id).single();
    const signed = so as { signed_at: string | null; signed_name: string; captured_on: string | null };
    expect(signed.signed_at).toBeTruthy();
    expect(signed.captured_on).toBe("staff_recorded");
    // The name on the record is the staff member's own, never the customer's.
    const staffId = await userIdFor(staff!);
    const { data: prof } = await db!.from("profiles").select("name").eq("id", staffId!).maybeSingle();
    const expectedName = ((prof as { name: string | null } | null)?.name ?? "").trim() || "Paint Group";
    expect(signed.signed_name).toBe(expectedName);
    const { data: warranty } = await db!.from("warranties").select("id").eq("work_order_id", id).maybeSingle();
    expect(warranty).toBeTruthy();
    const { data: ev } = await db!.from("wo_events").select("type").eq("work_order_id", id).eq("type", "completed_by_staff_after_qa");
    expect((ev ?? []).length).toBe(1);
  });

  test("'walkthrough not required' once the job is already at the walkthrough closes it from there", async () => {
    const id = noWalk!.workOrderId;
    await finishTheWork(noWalk!);
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: id, p_to: "completion_prep" })).toBe("ok:completion_prep");
    expect(await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: id })).toMatch(/^ok:/);
    expect(await rpcAs(staff!, "wo_book_walkthrough", {
      p_work_order_id: id, p_kind: "final",
      p_date: new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" }), p_note: "", p_time: null,
    })).toMatch(/^ok:/);
    expect((await stageOf(id)).stage).toBe("walkthrough");

    // Before the flag is off, the close is refused — the customer's walkthrough stands.
    expect(await rpcAs(staff!, "wo_close_without_walkthrough", { p_work_order_id: id })).toBe("error:walkthrough_required");

    expect(await rpcAs(staff!, "wo_set_walkthrough_required", { p_work_order_id: id, p_required: false })).toBe("ok:false");
    expect(await rpcAs(staff!, "wo_close_without_walkthrough", { p_work_order_id: id })).toBe("ok:closed");
    expect((await stageOf(id)).stage).toBe("closed");

    const { data: walks } = await db!.from("wo_walkthroughs").select("status").eq("work_order_id", id);
    expect(((walks ?? []) as { status: string }[]).every((w) => w.status === "cancelled")).toBe(true);
    const { data: so } = await db!.from("wo_signoff").select("signed_at, signed_kind").eq("work_order_id", id).single();
    expect((so as { signed_at: string | null; signed_kind: string }).signed_kind).toBe("no_walkthrough");
    // Twice is a no-op, never a second record.
    expect(await rpcAs(staff!, "wo_close_without_walkthrough", { p_work_order_id: id })).toBe("error:not_ready");
  });
});
