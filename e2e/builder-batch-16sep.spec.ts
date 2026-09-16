import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 16 Sep 2026 (afternoon batch), the two builder items beside the
 * option tick (which e2e/optional-substrates.spec.ts drives):
 *
 *   1. The title follows the job address. Once an address is on the
 *      estimate, Save names the estimate after it — whatever was typed.
 *   2. "+ Add a paint" in the Materials card: a product no substrate drives
 *      (a stain blocker, a primer) shown on the customer's "The paint we're
 *      supplying", with the estimator's note as its usage chip.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");

const surface = (id: number, code: string, label: string) => ({
  id, code, internalLabel: label, clientLabel: label, coats: 2, count: 1,
  hidden: false, media: [], measureL: null, measureH: null, qtyOverride: null,
  rateOverride: null, paintingHrOverride: null, prepHr: 0, priceOverride: null,
  productName: null, color: "", colorHex: "",
  coverageOverride: null, volumeOverride: null, unitPriceOverride: null, crewNote: "",
  hideQty: false, showCoats: true, showPrice: false, useCustomRate: false,
  customRate: null, open: false,
});

type Snap = { paints: Array<{ name: string; brand: string; usage: string[]; isPrep: boolean }> };

test.describe("builder batch, 16 Sep", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const token = `b16${run}${Date.now().toString(36)}abcdef`;
  let estimateId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Old name ${run}`, status: "draft", source: "manual", level_of_finish: 3, share_token: token,
      builder_state: {
        blocks: [{
          id: 1, kind: "area", name: "Hall", type: "Interior", areaType: "room", L: 4, W: 2, H: 2.4,
          isOption: false, description: "", open: false, media: [], surfaces: [surface(2, "Walls", "Walls")],
        }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {}, materialColours: {}, colourMatches: {},
        contact: { first_name: "Batch", last_name: "Customer", email: "", phone: "" },
        jobAddress: { address: `${run.slice(0, 2)} Paint Road`, city: "Clayton", state: "VIC", postal: "3168" },
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });

  test.afterAll(async () => {
    if (estimateId) await db!.from("estimates").delete().eq("id", estimateId);
  });

  test("Save names the estimate after the job address, and an added paint reaches the customer's paints", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    const expectedTitle = `${run.slice(0, 2)} Paint Road, Clayton`;

    // ---- 2. a paint by hand -------------------------------------------------
    const pick = page.getByTestId("extra-paint-pick");
    await expect(pick).toBeVisible();
    const options = pick.locator("option");
    expect(await options.count()).toBeGreaterThan(1);
    const productName = (await options.nth(1).textContent())!.trim();
    await pick.selectOption({ index: 1 });
    await page.getByTestId("extra-paint-add").click();
    await expect(page.getByTestId("extra-paint-0")).toContainText(productName);
    await page.getByTestId("extra-paint-usage-0").fill("Stain blocking on the ceiling");

    // ---- 1. save → title = address ------------------------------------------
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("title").eq("id", estimateId).single();
      return data?.title ?? null;
    }, { timeout: 20_000 }).toBe(expectedTitle);
    // The header shows it too, without a reload.
    await expect(page.locator(`input[value="${expectedTitle}"]`).first()).toBeVisible();

    const { data } = await db!.from("estimates").select("sent_snapshot, builder_state").eq("id", estimateId).single();
    const snap = data!.sent_snapshot as Snap;
    const extra = snap.paints.find((p) => p.usage.includes("Stain blocking on the ceiling"));
    expect(extra).toBeTruthy();
    expect(`${extra!.brand} ${extra!.name}`.trim()).toContain(extra!.name);
    expect((data!.builder_state as { extraPaints: Array<{ productName: string }> }).extraPaints[0].productName).toBe(productName);

    // ---- and the customer sees it --------------------------------------------
    await db!.from("estimates").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", estimateId);
    await page.goto(`/e/${token}`);
    await expect(page.getByText("The paint we're supplying")).toBeVisible();
    await expect(page.getByText("Stain blocking on the ceiling").first()).toBeVisible();
  });
});
