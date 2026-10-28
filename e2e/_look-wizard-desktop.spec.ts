import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { test } from "./helpers";
import { fillQuickAddress, openQuickLook, passGateIfShown, quickNext } from "./customer-journey/drive";

/**
 * Diagnostic, not a gate — wizard mobile v5's scope guard (build plan: "every
 * session ends with a desktop screenshot diff at 1470px proving nothing
 * moved"). Walks the desktop quick look at 1470 × 900 as an anonymous
 * customer and saves one screenshot per step, plus the gate and the range,
 * into WIZARD_DESKTOP_SHOTS. Run it on the base branch and on the session's
 * branch, then compare the two folders byte for byte (`cmp`). Skipped
 * unless the folder is named.
 */
const OUT = process.env.WIZARD_DESKTOP_SHOTS ?? "";

test.describe("wizard desktop screenshots (scope guard)", () => {
  test.skip(!OUT, "set WIZARD_DESKTOP_SHOTS=<folder> to save the screenshots");
  test.use({ viewport: { width: 1470, height: 900 }, deviceScaleFactor: 1 });

  test("one screenshot per desktop step at 1470px", async ({ page }) => {
    test.setTimeout(240_000);
    mkdirSync(OUT, { recursive: true });
    const shot = async (name: string) => {
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await page.waitForTimeout(700); // the step's entrance and the picture's transitions
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: "disabled", caret: "hide" });
    };
    const step = async (id: string) => expect(page.locator(`[data-quick-step='${id}']`)).toBeVisible({ timeout: 30_000 });
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: "Shotsville", postcode: "3163" });
    await shot("01-start");
    await quickNext(page);
    await step("place");
    await shot("02-place");
    await quickNext(page);
    await step("job");
    await shot("03-job");
    await quickNext(page);
    await step("rooms");
    await shot("04-rooms");
    await quickNext(page);
    await step("condition");
    await shot("05-condition");
    await quickNext(page);
    const gate = page.locator("[data-quick-step='gate']");
    await expect(gate.or(page.getByTestId("reveal"))).toBeVisible({ timeout: 90_000 });
    if (await gate.count()) await shot("06-gate");
    await passGateIfShown(page, { name: "Desktop Shots", email: "desktop.shots@example.com", mobile: "0400 000 777" });
    await expect(page.getByTestId("reveal-range")).toBeVisible({ timeout: 90_000 });
    await shot("07-range");
  });
});

export type { Page };
