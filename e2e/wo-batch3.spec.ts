import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 23 Aug (batch 3) — needs migration 20261105 live:
 *   · ONE quality check as standard (final); a mid-job check is added by the
 *     office, dated; a job can be flagged "quality check required";
 *   · the painter starts the walkthrough without a booking;
 *   · the painter moves the finish / walkthrough date — the booking's end and
 *     the work order follow, the final walkthrough re-books to that day;
 *   · staff record a sign-off from our side: areas approved on the customer's
 *     behalf, signed, warranty started, job closed.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;      // RPC rules + staff sign
let ui: LoopFixture | null = null;     // painter's finish-date card

const melbToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
const plus = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

async function bookAccepted(fx: LoopFixture, contractorId: string, start: string, end: string) {
  const { error } = await db!.from("booking_offers").insert({
    work_order_id: fx.workOrderId, contractor_id: contractorId, state: "accepted",
    start_date: start, end_date: end, offered_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), accepted_at: new Date().toISOString(),
  });
  expect(error).toBeNull();
}

test.describe("batch 3 — cadence, finish date, unbooked walkthrough, staff sign-off", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Front", labels: ["Walls"] }]);
    ui = await createLoopFixture(db!, cid, [{ heading: "Back", labels: ["Walls"] }]);
    const today = melbToday();
    await bookAccepted(f!, cid, today, plus(today, 2));
    await bookAccepted(ui!, cid, today, plus(today, 3));
    for (const x of [f!, ui!]) await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", x.workOrderId);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, f);
    await destroyLoopFixture(db!, ui);
  });

  test("one check as standard: finishing schedules the FINAL only; a mid-job check is added by the office", async () => {
    await completePrep(db!, staff!, f!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: f!.workOrderId }))
      .toBe("ok:completion_prep:qa_pending");
    const { data: checks } = await db!.from("wo_qa_checks").select("kind").eq("work_order_id", f!.workOrderId);
    expect(((checks ?? []) as { kind: string }[]).map((c) => c.kind)).toEqual(["final"]);

    const today = melbToday();
    expect(await rpcAs(contractor!, "wo_add_qa_check", { p_work_order_id: f!.workOrderId, p_date: today })).toBe("error:not_staff");
    const added = await rpcAs(staff!, "wo_add_qa_check", { p_work_order_id: f!.workOrderId, p_date: today });
    expect(added).toMatch(/^ok:/);
    const { data: mid } = await db!.from("wo_qa_checks").select("id, kind, scheduled_for").eq("id", added.slice(3)).maybeSingle();
    expect((mid as { kind: string; scheduled_for: string }).kind).toBe("mid");
    expect((mid as { kind: string; scheduled_for: string }).scheduled_for).toBe(today);
    const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", added.slice(3));
    expect((items ?? []).length).toBeGreaterThan(0);

    // The job-level flag is staff-only and idempotent on scheduling.
    expect(await rpcAs(contractor!, "wo_set_qa_required", { p_work_order_id: f!.workOrderId, p_required: true })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: f!.workOrderId, p_required: true })).toBe("ok:true");
    const { data: wo } = await db!.from("work_orders").select("qa_required").eq("id", f!.workOrderId).maybeSingle();
    expect((wo as { qa_required: boolean }).qa_required).toBe(true);
  });

  test("the painter moves the finish date: booking end, work order and final walkthrough follow", async () => {
    const today = melbToday();
    expect(await rpcAs(contractor!, "wo_contractor_set_finish_date", { p_work_order_id: f!.workOrderId, p_date: plus(today, -1) }))
      .toBe("error:before_start");
    expect(await rpcAs(contractor!, "wo_contractor_set_finish_date", { p_work_order_id: f!.workOrderId, p_date: plus(today, 4) }))
      .toBe(`ok:${plus(today, 4)}`);
    const { data: offer } = await db!.from("booking_offers").select("end_date").eq("work_order_id", f!.workOrderId).eq("state", "accepted").maybeSingle();
    expect((offer as { end_date: string }).end_date).toBe(plus(today, 4));
    const { data: wo } = await db!.from("work_orders").select("end_date").eq("id", f!.workOrderId).maybeSingle();
    expect((wo as { end_date: string }).end_date).toBe(plus(today, 4));
    const { data: walks } = await db!.from("wo_walkthroughs").select("kind, status, scheduled_date")
      .eq("work_order_id", f!.workOrderId).eq("kind", "final").eq("status", "booked");
    expect(((walks ?? []) as { scheduled_date: string }[]).map((w) => w.scheduled_date)).toEqual([plus(today, 4)]);
  });

  test("walkthrough starts without a booking; staff can record the sign-off from our side", async () => {
    // Pass both checks (final + mid) → routes to walkthrough.
    const { data: checks } = await db!.from("wo_qa_checks").select("id").eq("work_order_id", f!.workOrderId);
    for (const c of (checks ?? []) as { id: string }[]) {
      const { data: items } = await db!.from("wo_qa_items").select("id").eq("qa_check_id", c.id);
      for (const item of (items ?? []) as { id: string }[]) await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: item.id, p_done: true });
      expect(await rpcAs(staff!, "wo_record_qa", { p_check_id: c.id, p_result: "pass", p_notes: "e2e", p_rectify: [] })).toMatch(/^ok:pass/);
    }
    // Prep was completed; confirm routes to qa, then the passes route on.
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: f!.workOrderId })).toMatch(/^ok:(qa|walkthrough)/);
    await rpcAs(staff!, "wo_qa_route_passed", { p_work_order_id: f!.workOrderId });
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", f!.workOrderId).maybeSingle();
    expect((wo as { stage: string }).stage).toBe("walkthrough");

    // Cancel the booked final: the painter can STILL start the walkthrough.
    await db!.from("wo_walkthroughs").update({ status: "cancelled" }).eq("work_order_id", f!.workOrderId);
    const started = await rpcAs(contractor!, "wo_start_walkthrough_mode", { p_work_order_id: f!.workOrderId });
    expect(started).toMatch(/^ok:/);

    // Staff record the sign-off: the one area is approved for them, signed, closed.
    expect(await rpcAs(contractor!, "wo_staff_sign", { p_work_order_id: f!.workOrderId, p_name: "Pat Customer", p_note: "" })).toBe("error:not_staff");
    expect(await rpcAs(staff!, "wo_staff_sign", { p_work_order_id: f!.workOrderId, p_name: "", p_note: "" })).toBe("error:no_name");
    expect(await rpcAs(staff!, "wo_staff_sign", { p_work_order_id: f!.workOrderId, p_name: "Pat Customer", p_note: "By phone 3:10pm" })).toBe("ok:signed");
    const { data: so } = await db!.from("wo_signoff").select("signed_at, signed_name, signed_kind, captured_on, areas")
      .eq("work_order_id", f!.workOrderId).maybeSingle();
    const row = so as { signed_at: string | null; signed_name: string; signed_kind: string; captured_on: string; areas: Record<string, { approved_at?: string; via?: string }> };
    expect(row.signed_at).not.toBeNull();
    expect(row.signed_name).toBe("Pat Customer");
    expect(row.captured_on).toBe("staff_recorded");
    expect(row.areas.Front?.approved_at).toBeTruthy();
    expect(row.areas.Front?.via).toBe("staff");
    const { data: closed } = await db!.from("work_orders").select("stage").eq("id", f!.workOrderId).maybeSingle();
    expect((closed as { stage: string }).stage).toBe("closed");
    const { data: warranty } = await db!.from("warranties").select("id").eq("work_order_id", f!.workOrderId);
    expect((warranty ?? []).length).toBe(1);
    // A second press: the job is closed now, so the stage check answers first.
    expect(await rpcAs(staff!, "wo_staff_sign", { p_work_order_id: f!.workOrderId, p_name: "Pat Customer", p_note: "" }))
      .toMatch(/^(ok:already|error:not_at_walkthrough)$/);
  });

  test("the painter's page shows the finish date and lets them move it; the staff card shows the estimated finish", async ({ page }) => {
    const today = melbToday();
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${ui!.workOrderId}`);
    await expect(page.getByTestId("finish-date")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("finish-date-change").click();
    await page.getByTestId("finish-date-input").fill(plus(today, 5));
    await page.getByTestId("finish-date-save").click();
    await expect(page.getByTestId("finish-date-msg")).toContainText(/moved/i, { timeout: 15_000 });
    const { data: wo } = await db!.from("work_orders").select("end_date").eq("id", ui!.workOrderId).maybeSingle();
    expect((wo as { end_date: string }).end_date).toBe(plus(today, 5));

    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${ui!.workOrderId}`);
    await expect(page.getByTestId("estimated-finish")).toContainText(/6 days booked/, { timeout: 15_000 });
    await expect(page.getByTestId("walkthrough-pick-date")).toBeVisible();
    await expect(page.getByTestId("qa-controls")).toBeVisible();
  });
});
