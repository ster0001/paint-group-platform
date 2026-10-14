import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, rpcAs, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 14 Oct 2026 — 73 Kerferd Street (PS-3613), recreated: base $5,040
 * (84 h at $60), the office moves the rate to $67 in Revise scope, and two
 * changes the customer signed were ALREADY drafted at $67 (6 h $402, 3 h $201)
 * beside two the office approved for the contractor only ($240, $360). The
 * painter is asked $6,243 → $6,831 — the $7 uplift on the 84 base hours only,
 * never again on the 9 hours already at $67 — and ends on $6,831.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
let f: LoopFixture | null = null;

test.describe.serial("Rate change to the painter — each hour uplifted once", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Front Side", labels: ["Fascias"] }]);
    const up = await db!.from("work_orders").update({ contractor_payment_cents: 504000, contractor_rate_cents: null }).eq("id", f.workOrderId);
    if (up.error) throw new Error(`fixture pay: ${up.error.message}`);
    const ins = await db!.from("wo_variations").insert([
      { work_order_id: f.workOrderId, raised_kind: "contractor", category: "damage", comment: "Pergola cracks",
        status: "contractor_accepted", price_cents: 0, contractor_delta_cents: 24000, est_hours: 4, credit: false },
      { work_order_id: f.workOrderId, raised_kind: "contractor", category: "extra_scope", comment: "Back & right side eaves",
        status: "contractor_accepted", price_cents: 0, contractor_delta_cents: 36000, credit: false },
      { work_order_id: f.workOrderId, raised_kind: "staff", category: "rot", comment: "Front Side — scope changed",
        status: "contractor_accepted", price_cents: 74794, contractor_delta_cents: 40200, est_hours: 6,
        contractor_rate_cents: 6700, revision_block_ref: "block:3", credit: false },
      { work_order_id: f.workOrderId, raised_kind: "staff", category: "rot", comment: "Back — scope changed",
        status: "contractor_accepted", price_cents: 42381, contractor_delta_cents: 20100, est_hours: 3,
        contractor_rate_cents: 6700, revision_block_ref: "block:17", credit: false },
    ]);
    if (ins.error) throw new Error(`fixture variations: ${ins.error.message}`);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, f); });

  test("the office's new rate asks the painter $6,243 → $6,831", async () => {
    const { data: est } = await db!.from("work_orders").select("estimate_id").eq("id", f!.workOrderId).single();
    const r = await rpcAs(staff!, "wo_sync_contractor_pay", {
      p_estimate_id: (est as { estimate_id: string }).estimate_id,
      p_base_cents: 562800, p_rate_cents: 6700, p_accepted_rate_cents: 6000, p_base_hours: 84,
    });
    expect(r).toBe("ok:pay_change_sent");
    const { data } = await db!.from("work_orders").select("pay_change_from_cents, pay_change_to_cents").eq("id", f!.workOrderId).single();
    expect(data).toMatchObject({ pay_change_from_cents: 624300, pay_change_to_cents: 683100 });
  });

  test("the painter sees it and accepts — their pay for the job is $6,831", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${f!.workOrderId}`);
    await expect(page.getByTestId("pay-change-rate")).toContainText("$60");
    await expect(page.getByTestId("pay-change-rate")).toContainText("$67");
    await expect(page.getByTestId("pay-change-pay")).toHaveText("Pay for this job $6,243.00 → $6,831.00");
    await page.getByTestId("pay-change-accept").click();
    await expect(page.getByTestId("pay-change-done")).toContainText("$6,831");

    const { data } = await db!.from("work_orders").select("contractor_payment_cents, contractor_rate_cents, pay_change_rate_cents").eq("id", f!.workOrderId).single();
    expect(data).toMatchObject({ contractor_payment_cents: 562800, contractor_rate_cents: 6700, pay_change_rate_cents: null });
    await page.reload();
    await expect(page.getByTestId("wo-payment")).toContainText("$6,831");
  });
});
