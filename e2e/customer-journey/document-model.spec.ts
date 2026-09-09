import { test, expect } from "@playwright/test";
import { openQuickLook, driveNoPlanWizard } from "./drive";

/**
 * R1.3 — the document model (diagnostic #2 and #3).
 *
 * Three document types with fixed semantics:
 *   floorplan       interior only, EXACTLY ONE, replace-not-add
 *   condition_photo many, feeds the damage reader; failures always VISIBLE
 *   facade_photo    exterior, 2–3, estimator's eyes for v1
 *
 * The bugs this encodes: the plan input accepted many files with the primary
 * run pinned forever to the first; the exterior path still showed a floorplan
 * intake; and a customer whose damage photos couldn't be analysed was told
 * nothing at all.
 */

const FIXTURES = "e2e/fixtures";

test.describe("R1.3 document model", () => {
  test("floorplan intake is exactly one file — a second upload replaces", async ({ page }) => {
    test.setTimeout(120_000);
    await openQuickLook(page);

    // The input is single-file at the DOM level, not just by convention.
    await page.getByTestId("entry-upload").click();
    const [chooserA] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /Upload a floorplan/ }).click(),
    ]);
    expect(chooserA.isMultiple()).toBe(false);
    await chooserA.setFiles(`${FIXTURES}/not-a-plan-a.png`);
    await expect(page.locator(".wz-upload")).toContainText(/Floorplan uploaded/i, { timeout: 30_000 });
    // Replace-not-add: the control offers replacement, never "add another".
    await expect(page.locator(".wz-upload")).toContainText(/replace/i);
    await expect(page.locator(".wz-upload")).not.toContainText(/add another/i);

    const [chooserB] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator(".wz-upload").click(),
    ]);
    await chooserB.setFiles(`${FIXTURES}/not-a-plan-b.png`);
    // Still exactly one plan on file after the second upload.
    await expect(page.locator(".wz-upload")).toContainText(/Floorplan uploaded/i, { timeout: 30_000 });
    await expect(page.locator(".wz-upload")).not.toContainText(/2 files/);
  });

  test("the exterior path has no floorplan field anywhere", async ({ page }) => {
    await openQuickLook(page);
    // v2 phase 2: the chip reads "Outside", and the answer reaches the state
    // immediately — the upload route branches on it, so a customer who picked
    // Outside must not be offered a floorplan field.
    await page.getByTestId("ql-jobtype-exterior").click();
    await page.getByTestId("entry-upload").click();
    await expect(page.getByRole("button", { name: /Upload a floorplan/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /floorplan to hand/ })).toHaveCount(0);
    // The facade intake is what exterior offers instead.
    await page.getByTestId("entry-upload").click(); // Phase 2: the way in is a card
    await expect(page.getByRole("button", { name: /Add facade photos/ })).toBeVisible();
  });

  test("condition photos that can't be analysed end in a VISIBLE state", async ({ page }) => {
    test.setTimeout(180_000);
    page.on("response", async (r) => {
      if (r.url().includes("/api/extract/photos") || (r.url().includes("/api/") && r.status() >= 400)) {
        console.log("API", r.status(), r.url().split("/api/")[1], (await r.text().catch(() => "")).slice(0, 300));
      }
    });
    /**
     * v2 phase 2: the customer's condition photos arrive through the EDITOR's
     * spots, not a stub on a wizard page — the quick look asks eight questions
     * and none of them is "attach a photo of the damage". The precondition this
     * spec exists for is unchanged and now universal: a quick-look job has no
     * plan run, so the damage reader has nowhere to go, and that used to fail
     * into silence.
     */
    await driveNoPlanWizard(page);
    const areaId = await page.locator("[data-room]").first().getAttribute("data-room");
    await page.locator(`[data-room="${areaId}"] .il-hd`).click();
    await page.getByTestId(`spot-open-${areaId}`).click();
    await page.getByTestId(`spot-photo-${areaId}`).setInputFiles(`${FIXTURES}/condition-photo.png`);
    await page.getByTestId(`spot-tag-${areaId}-water`).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

    // The customer is TOLD what happened to their photos — an amber trace,
    // never silence. Either the analysed-prep path or the flagged-for-review
    // path is acceptable; invisibility is not.
    await expect(
      page.locator(".wz-photonote, .wz-confirmonsite, .sc-spots", { hasText: /photo|damage|water|review|site/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
