import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { credentials, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/** Look-only: screenshots of the showcase editor + preview with a real photo. */
const staff = credentials("STAFF");
const db = serviceClient();
const OUT = process.env.LOOK_OUT ?? "/tmp";

test("look: showcase editor + preview", async ({ page }) => {
  test.skip(!staff || !db, "needs staff creds + service key");
  const run = randomBytes(3).toString("hex");
  await page.setViewportSize({ width: 1400, height: 1000 });
  await signIn(page, staff!, /\/estimates/);
  await page.goto("/settings/showcase/new");
  const PNG = await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 600 } });
  await page.getByTestId("showcase-hero-upload").setInputFiles({ name: "hero.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("showcase-hero-img")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("showcase-gallery-upload").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG }, { name: "b.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.getByTestId("gallery-row")).toHaveCount(2, { timeout: 20_000 });
  await page.getByTestId("showcase-consent").check();
  await page.getByTestId("showcase-title").fill("Exterior weatherboard");
  await page.getByTestId("showcase-type").selectOption("exterior");
  await page.getByTestId("showcase-suburb").fill("Thornbury");
  await page.getByTestId("showcase-slug").fill(`look-${run}`);
  await page.getByTestId("showcase-month").fill("2026-07");
  await page.getByTestId("showcase-days").fill("6");
  await page.getByTestId("showcase-price-low").fill("14200");
  await page.getByTestId("showcase-price-high").fill("15800");
  await page.getByTestId("showcase-scope").fill("Whole exterior, 2 coats, fascias & gutters, front fence");
  await page.getByTestId("showcase-summary").fill("A 1920s weatherboard in Thornbury, sanded back, primed and given two coats over six days. Fascias, gutters and the front fence done in the same run.");
  await page.getByTestId("wwd-add").click();
  const wwdRow = page.getByTestId("wwd-row").last();
  await wwdRow.getByLabel("Area").fill("Weatherboards");
  await wwdRow.getByLabel("Work").fill("Wash, sand, prime bare timber, 2 coats");
  await page.getByTestId("colour-add").click();
  const colourRow = page.getByTestId("colour-row").last();
  await colourRow.getByLabel("Brand").fill("Dulux");
  await colourRow.getByLabel("Product").fill("Weathershield");
  await colourRow.getByLabel("Colour", { exact: true }).fill("Natural White");
  await page.getByTestId("showcase-published").check();
  await page.getByTestId("showcase-save").click();
  await expect(page.getByTestId("showcase-status")).toContainText("Published", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/look-editor-desktop.png`, fullPage: false });
  const pane = page.getByTestId("showcase-preview-pane").locator("> div");
  await pane.evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: `${OUT}/look-editor-top.png` });
  await pane.evaluate((el) => { el.scrollTop = 900; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/look-editor-preview-mid.png` });
  // mobile sheet
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("showcase-preview-open").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/look-editor-sheet-mobile.png` });
  await page.getByTestId("showcase-preview-sheet").locator(".mk").evaluate((el) => { el.parentElement!.scrollTop = 700; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/look-editor-sheet-mobile-2.png` });
  await db!.from("showcase_jobs").delete().eq("slug", `look-${run}`);
});
