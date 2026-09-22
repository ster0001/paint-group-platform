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
    await signIn(page, staff!, /\/(home|estimates)/);
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

  /**
   * Tom, 16 Sep (later): "if I click Change to change the window to a
   * different type, make sure the label changes for the client automatically."
   * The customer label used to survive a re-pick; now both labels follow the
   * new substrate, and the area's description line with it.
   */
  test("Change to a different substrate renames it for the customer", async ({ page }) => {
    test.setTimeout(180_000);
    await db!.from("estimates").update({ status: "draft", sent_at: null }).eq("id", estimateId);
    // Give the Walls row a customer label of its own, the way the wizard does.
    const { data: cur } = await db!.from("estimates").select("builder_state").eq("id", estimateId).single();
    const bs = cur!.builder_state as { blocks: Array<{ description: string; surfaces: Array<{ id: number; clientLabel: string }> }> };
    bs.blocks[0].surfaces[0].clientLabel = "Walls — colour to confirm";
    bs.blocks[0].description = "<p>Walls — colour to confirm</p>";
    await db!.from("estimates").update({ builder_state: bs }).eq("id", estimateId);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await page.getByText("Hall", { exact: true }).first().click();
    await page.getByTestId("surface-row-2").click();
    await expect(page.getByLabel("Client Label")).toHaveValue("Walls — colour to confirm");
    // Tom, 22 Sep: the Materials row carries the client label, not the substrate code.
    await expect(page.getByTestId("material-row-label-Interior::Walls")).toHaveText("Walls — colour to confirm");

    // The button sits inside the field's <label>; click its own text.
    await page.getByText("Change ›").first().click({ force: true });
    await expect(page.getByPlaceholder("Search all surfaces…")).toBeVisible();
    await page.getByPlaceholder("Search all surfaces…").fill("Ceilings");
    await page.locator("button", { hasText: /^Ceilings\s*·/ }).first().click();

    await expect(page.getByLabel("Client Label")).toHaveValue("Ceilings");
    await expect(page.getByLabel("Internal Label")).toHaveValue("Ceilings");
    await expect(page.getByTestId("material-row-label-Interior::Ceilings")).toHaveText("Ceilings");
    // …and typing a new client label moves the Materials row with it, at once.
    await page.getByLabel("Client Label").fill("Feature ceiling");
    await expect(page.getByTestId("material-row-label-Interior::Ceilings")).toHaveText("Feature ceiling");

    // Save from the header — it is there on every screen of the builder.
    await page.getByTestId("builder-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", estimateId).single();
      const b = data?.builder_state as typeof bs | null;
      return b?.blocks[0].surfaces[0].clientLabel ?? null;
    }, { timeout: 20_000 }).toBe("Ceilings");
    const { data } = await db!.from("estimates").select("builder_state, sent_snapshot").eq("id", estimateId).single();
    expect((data!.builder_state as typeof bs).blocks[0].description).toContain("<p>Ceilings</p>");
    const snap = data!.sent_snapshot as { areas: Array<{ surfaces: Array<{ label: string }> }> };
    expect(snap.areas[0].surfaces.map((x) => x.label)).toEqual(["Ceilings"]);
  });
});
