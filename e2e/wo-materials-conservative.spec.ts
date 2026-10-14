import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, createLoopFixture, destroyLoopFixture, serviceClient, type LoopFixture } from "./fixtures/woLoop";

/**
 * Tom, 13 Oct 2026 — "Materials calculations aren't accurate and don't add up
 * to the estimated materials … should be rounded down rather than up. The can
 * sizes come in 1, 2, 4, 10 or 15."
 *
 *  · the painter's sheet (anonymous, by token) shows each paint's ORDER in
 *    cans over the estimate's own litres, and every area lists its own paint;
 *    no cost ever reaches it;
 *  · PC Command shows the estimate beside each row, flags a sheet frozen
 *    under the old round-up, and one tap sets the conservative order;
 *  · the pre-start's materials item labels the paint estimate.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;
let shareToken = "";
const WALLS = "Wash & Wear Low Sheen||Lexicon Quarter";
const TRIM = "Aquanamel Semi Gloss||Lexicon Quarter";

test.describe("Work order materials — conservative order + estimate litres", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    f = await createLoopFixture(db!, cid, [{ heading: "Lounge", labels: ["Walls", "Skirting"] }]);
    const { data, error } = await db!.from("work_orders").select("share_token, wo_snapshot").eq("id", f.workOrderId).single();
    if (error) throw new Error(`fixture: ${error.message}`);
    const row = data as { share_token: string; wo_snapshot: Record<string, unknown> };
    shareToken = row.share_token;
    // Walls frozen the NEW way (13 L order from 13.8 L); trim frozen under the
    // OLD round-up (2.6 L estimate → a 4 L tin), the sheet Tom complained about.
    const { error: upErr } = await db!.from("work_orders").update({
      wo_snapshot: {
        ...row.wo_snapshot,
        materials: [
          { product: "Wash & Wear Low Sheen", colourKey: WALLS, photoUrl: "", litres: 13, estimatedLitres: 13.8, coverageMissing: false,
            colourName: "Lexicon Quarter", colourHex: "#EDEDE8", colourStatus: "confirmed" },
          { product: "Aquanamel Semi Gloss", colourKey: TRIM, photoUrl: "", litres: 4, coverageMissing: false,
            colourName: "Lexicon Quarter", colourHex: "#EDEDE8", colourStatus: "confirmed" },
        ],
        areas: [{
          id: "a0", title: "Lounge", finishCode: "PG-3", finishOverridden: false, photos: [],
          surfaces: [
            { key: "a0:0", label: "Walls", coats: 2, product: "Wash & Wear Low Sheen", colourKey: WALLS, colourName: "Lexicon Quarter", colourHex: "#EDEDE8", litres: 13.8, prep: "", hours: 6, status: "not_started" },
            { key: "a0:1", label: "Skirting", coats: 2, product: "Aquanamel Semi Gloss", colourKey: TRIM, colourName: "Lexicon Quarter", colourHex: "#EDEDE8", litres: 2.6, prep: "", hours: 2, status: "not_started" },
          ],
        }],
      },
    }).eq("id", f.workOrderId);
    if (upErr) throw new Error(`fixture snapshot: ${upErr.message}`);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, f); });

  test("the painter's sheet: order in cans, the estimate litres, and each area's paint — no cost", async ({ page }) => {
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByTestId(`mat-order-${WALLS}`)).toHaveText("13 L");
    await expect(page.getByTestId(`mat-cans-${WALLS}`)).toHaveText("10 L + 2 L + 1 L");
    await expect(page.getByTestId(`mat-estimate-${WALLS}`)).toHaveText("Estimate 13.8 L");
    // the old sheet's trim row: estimate from its surfaces, beside the 4 L it froze
    await expect(page.getByTestId(`mat-estimate-${TRIM}`)).toHaveText("Estimate 2.6 L");

    const area = page.getByTestId("area-materials-a0");
    await expect(area).toContainText("Materials for this area");
    await expect(area).toContainText("Wash & Wear Low Sheen · Lexicon Quarter");
    await expect(area).toContainText("13.8 L");
    await expect(area).toContainText("Aquanamel Semi Gloss · Lexicon Quarter");
    await expect(area).toContainText("2.6 L");
    // contractor-facing: litres only, never a materials cost
    await expect(area).not.toContainText("$");
  });

  test("PC Command: estimate beside each row, the old round-up flagged, one tap to the conservative order", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const card = page.getByTestId("materials-card");
    await expect(card.getByTestId(`material-estimate-${WALLS}`)).toContainText("Estimate 13.8 L");
    await expect(card.getByTestId(`material-estimate-${WALLS}`)).toContainText("cans 10 L + 2 L + 1 L");
    await expect(card.getByTestId(`material-over-${WALLS}`)).toHaveCount(0);
    await expect(card.getByTestId(`material-over-${TRIM}`)).toContainText("conservative: 2 L");

    await card.getByTestId(`material-edit-${TRIM}`).click();
    await card.getByTestId(`material-conservative-${TRIM}`).click();
    await expect(card.getByTestId(`material-litres-${TRIM}`)).toHaveValue("2");
    await card.getByTestId(`material-save-${TRIM}`).click();
    await expect(card.getByTestId("materials-msg")).toContainText("job sheet");
    await expect(card.getByTestId(`material-order-${TRIM}`)).toHaveText("Order 2 L");
    await expect(card.getByTestId(`material-over-${TRIM}`)).toHaveCount(0);

    const { data, error } = await db!.from("work_orders").select("wo_snapshot").eq("id", f!.workOrderId).single();
    expect(error).toBeNull();
    const mats = (data as { wo_snapshot: { materials: { colourKey: string; litres: number }[] } }).wo_snapshot.materials;
    expect(mats.find((m) => m.colourKey === TRIM)!.litres).toBe(2);
  });

  test("pre-start: the materials item labels the paint estimate", async ({ page }) => {
    const { error } = await db!.from("work_orders").update({ stage: "pre_start" }).eq("id", f!.workOrderId);
    expect(error).toBeNull();
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${f!.workOrderId}`);
    const est = page.getByTestId("prestart-paint-estimate");
    await expect(est).toBeVisible();
    await expect(est.getByTestId(`prestart-paint-${WALLS}`)).toContainText("est. 13.8 L");
    await expect(est.getByTestId(`prestart-paint-${WALLS}`)).toContainText("order 10 L + 2 L + 1 L");
  });
});
