import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 4 Sep 2026: "when adjusting numbers in the builder you can't delete
 * the first digit — you have to type a digit in front of it."
 *
 * Every number box was controlled by the parsed number, so clearing it wrote
 * "0" (or the calculated fallback) straight back. NumInput keeps the text
 * while you type: clear the box, it stays clear; type 5, the figure is 5.
 */
const db = serviceClient();
const staff = credentials("STAFF");

test.describe("builder number boxes", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  const run = randomBytes(3).toString("hex");
  let estimateId = "";

  test.beforeAll(async () => {
    const est = await db!.from("estimates").insert({
      title: `Number boxes ${run}`, status: "draft", source: "manual",
      builder_state: {
        blocks: [{ id: 1, kind: "area", name: "Living room", type: "Interior", areaType: "room", L: 4, W: 3, H: 2.4, isOption: false, description: "", open: false, media: [], surfaces: [] }],
        modSel: { "Level of Finish": "FIN-3" }, materials: {},
      },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  test("clear a box and it stays clear; the first digit can be deleted", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/quote?id=${estimateId}`);
    await page.waitForLoadState("networkidle");
    await page.getByText("Living room", { exact: true }).first().click();

    // The area's Length box: "4" → clear → stays "" (not "0") → type 5.
    const length = page.locator("label", { hasText: "Length m" }).locator("input[type=number]");
    await expect(length).toHaveValue("4");
    await length.click();
    await length.press("End");
    await length.press("Backspace");
    await expect(length).toHaveValue("");
    await length.type("5");
    await expect(length).toHaveValue("5");
    // Blur settles on the committed figure.
    await length.blur();
    await expect(length).toHaveValue("5");

    // The deposit % box (a plain figure, empty = 0): same behaviour.
    const deposit = page.locator("span", { hasText: /^Deposit/ }).locator("input[type=number]").first();
    const before = await deposit.inputValue();
    await deposit.click();
    await deposit.press("End");
    for (let i = 0; i < before.length; i++) await deposit.press("Backspace");
    await expect(deposit).toHaveValue("");
    await deposit.type("15");
    await expect(deposit).toHaveValue("15");
  });
});
