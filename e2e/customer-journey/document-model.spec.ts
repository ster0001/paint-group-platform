import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "../helpers";

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
    const staff = credentials("STAFF");
    test.skip(!staff, missingCreds("STAFF"));
    test.setTimeout(120_000);
    await signIn(page, staff!, /estimates/);
    await page.goto("/estimate");

    // The input is single-file at the DOM level, not just by convention.
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
    const staff = credentials("STAFF");
    test.skip(!staff, missingCreds("STAFF"));
    await signIn(page, staff!, /estimates/);
    await page.goto("/estimate");
    await page.getByRole("button", { name: "Exterior", exact: true }).click();

    await expect(page.getByRole("button", { name: /Upload a floorplan/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /floorplan to hand/ })).toHaveCount(0);
    // The facade intake is what exterior offers instead.
    await expect(page.getByRole("button", { name: /Add facade photos/ })).toBeVisible();
  });

  test("condition photos that can't be analysed end in a VISIBLE state", async ({ page }) => {
    const staff = credentials("STAFF");
    test.skip(!staff, missingCreds("STAFF"));
    test.setTimeout(180_000);
    page.on("response", async (r) => {
      if (r.url().includes("/api/extract/photos") || (r.url().includes("/api/") && r.status() >= 400)) {
        console.log("API", r.status(), r.url().split("/api/")[1], (await r.text().catch(() => "")).slice(0, 300));
      }
    });
    await signIn(page, staff!, /estimates/);
    await page.goto("/estimate");

    // No-plan path (no plan run = the damage reader has nowhere to go —
    // exactly the precondition that used to fail into silence).
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    const answer = async (heading: string | RegExp, label: string) => {
      const row = page.locator(".wz-qhead", { hasText: heading })
        .locator("xpath=following-sibling::div[1]")
        .getByRole("button", { name: label, exact: true });
      if (await row.count()) await row.first().click();
    };
    await answer("Heritage listed", "No");
    await answer("What kind of property", "House");
    const next = async () => {
      await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
      const err = page.locator(".wz-err");
      if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
    };
    await next(); // surfaces
    await next(); // condition
    await next(); // details
    await answer(/built before 1970/, "No");
    await page.getByRole("button", { name: /a few areas of concern/i }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator(".wz-photo-stub").click(),
    ]);
    await chooser.setFiles(`${FIXTURES}/condition-photo.png`);
    await next(); // paint
    await next(); // email gate
    const email = page.locator("input[type=email]");
    if (await email.count()) await email.fill(`e2e-docmodel-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "See my estimate" }).click();
    await expect(page.locator(".wz-r")).toBeVisible({ timeout: 90_000 });

    // The customer is TOLD what happened to their photos — an amber trace,
    // never silence. Either the analysed-prep path or the flagged-for-review
    // path is acceptable; invisibility is not.
    await expect(
      page.locator(".wz-photonote, .wz-confirmonsite", { hasText: /photo|damage|review|site/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
