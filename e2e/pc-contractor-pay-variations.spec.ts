import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 14 Oct 2026 (73 Kerferd, PS-3613): "the variations I approved in PC
 * Command which weren't sent to the customer haven't been added". The job
 * page's Contractor figure read the base offer only, so a variation approved
 * for the contractor alone (no customer price) showed nowhere on PC Command
 * while the painter's portal counted it. Both now read the one pay rule:
 * offer + every accepted variation's delta.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
let f: LoopFixture | null = null;

test.describe("PC Command — contractor pay includes accepted variations", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Back", labels: ["Eaves"] }]);
    const up = await db!.from("work_orders").update({ contractor_payment_cents: 504000 }).eq("id", f.workOrderId);
    if (up.error) throw new Error(`fixture pay: ${up.error.message}`);
    const ins = await db!.from("wo_variations").insert([
      // approved in PC Command for the contractor only — no customer price
      { work_order_id: f.workOrderId, raised_kind: "contractor", category: "extra_scope", comment: "Back & right side eaves",
        status: "contractor_accepted", price_cents: 0, contractor_delta_cents: 36000, credit: false },
      // signed by the customer, then accepted by the painter
      { work_order_id: f.workOrderId, raised_kind: "staff", category: "rot", comment: "Front gable",
        status: "contractor_accepted", price_cents: 74794, contractor_delta_cents: 40200, credit: false },
    ]);
    if (ins.error) throw new Error(`fixture variations: ${ins.error.message}`);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, f); });

  test("the Contractor figure is the offer plus both variations, the contractor-only one included", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    // $5,040 + $360 + $402 = $5,802
    await expect(page.getByTestId("money-contractor")).toHaveText("$5,802");
    await expect(page.getByTestId("money-contractor-variations")).toHaveText("$5,040 + $762 variations");
    // the customer's side still counts only what the customer signed
    await expect(page.getByTestId("money-variations")).toHaveText("+ $748");
  });
});

test.describe("PC Command — a rate change waiting on the painter says so", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  let g: LoopFixture | null = null;

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    g = await createLoopFixture(db!, cid, [{ heading: "Front", labels: ["Fascias"] }]);
    // 73 Kerferd, 14 Oct 2026: $60 → $67 sent to the painter, not yet answered.
    const up = await db!.from("work_orders").update({
      contractor_payment_cents: 504000,
      pay_change_rate_cents: 6700, pay_change_from_rate_cents: 6000, pay_change_base_hours: 84,
      pay_change_from_cents: 504000, pay_change_to_cents: 562800, pay_change_sent_at: new Date().toISOString(),
    }).eq("id", g.workOrderId);
    if (up.error) throw new Error(`fixture pay change: ${up.error.message}`);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, g); });

  test("the agreed pay stands, with the pending figure and rate under it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${g!.workOrderId}`);
    await expect(page.getByTestId("money-contractor")).toHaveText("$5,040");
    const pending = page.getByTestId("money-pay-change-pending");
    await expect(pending).toContainText("$5,628 waiting on");
    await expect(pending).toContainText("to accept $60/h → $67/h");
  });
});
