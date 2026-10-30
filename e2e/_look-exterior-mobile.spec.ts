import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { test } from "./helpers";
import { fillQuickAddress, openQuickLook, MONEY_RANGE } from "./customer-journey/drive";

/**
 * Diagnostic, not a gate — exterior on mobile v5's screenshot set (plan §5
 * session 7: "screenshots to docs/wizard-mobile/exterior/"). Walks the
 * outside path on a phone (390 × 780, anonymous) through every screen of a
 * Californian bungalow — Your home, Painting, About it, Each side, the
 * details, the gate, the walk-around, the tightened gate — and saves one
 * screenshot per screen into EXTERIOR_MOBILE_SHOTS. Skipped unless named.
 */
const OUT = process.env.EXTERIOR_MOBILE_SHOTS ? "docs/wizard-mobile/exterior" : "";

test.describe("exterior mobile screenshots (the plan's set)", () => {
  test.skip(!OUT, "set EXTERIOR_MOBILE_SHOTS=1 to save the screenshots");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  test("one screenshot per phone screen of the outside path", async ({ page }) => {
    test.setTimeout(300_000);
    mkdirSync(OUT, { recursive: true });
    const at = (id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 20_000 });
    const shot = async (name: string) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", caret: "hide" }); };
    const tap = (id: string) => page.getByTestId(id).tap();
    const next = async (to: string) => { await tap("ql-next"); await at(to); };
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: "Shotsville" });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await shot("01-what");
    await tap("ql-jobtype-exterior"); await at("property");
    await tap("ql-kind-house"); await at("shape"); await shot("02-shape");
    await tap("ql-ext-type-cal"); await at("size"); await shot("03-size");
    await tap("ql-ext-size-md"); await at("p-house"); await shot("05a-house");
    for (const p of ["walls", "gable", "fascias", "eaves"]) await tap(`ext-part-${p}`);
    await page.waitForTimeout(800); await shot("05a-house-ticked");
    await page.getByTestId("wzm-strip").tap(); await page.waitForTimeout(500); await shot("05a-sheet"); await page.keyboard.press("Escape");
    await next("p-win"); await tap("ext-part-windows"); await tap("ext-part-doors"); await shot("05b-windows-doors");
    await next("p-ver"); await tap("ext-part-verandah"); await shot("05c-verandah");
    await next("p-around"); await tap("ext-extra-paling_fence"); await shot("05d-around");
    await next("a-walls"); await shot("06a-walls");
    await tap("ext-mat-weatherboards"); await at("a-gable"); await shot("06-gable");
    await tap("ext-gable-stucco"); await at("a-win"); await shot("06-windows");
    await tap("ql-ext-win-casement"); await at("a-extras"); await shot("06-sizes");
    await next("a-colours"); await shot("07-colours");
    await tap("ql-ext-colour-new"); await at("a-access"); await shot("08-access");
    await next("s-front"); await shot("09a-front");
    await page.getByTestId("wzm-strip").tap(); await page.waitForTimeout(500); await shot("09a-sheet"); await page.keyboard.press("Escape");
    await next("s-right"); await shot("09b-right");
    await next("s-back"); await next("s-left"); await shot("09d-left");
    await next("details"); await shot("10-details");
    await page.getByTestId("gate-name").fill("Shots Person");
    await page.getByTestId("gate-mobile").fill("0400 000 778");
    await page.getByTestId("gate-email").fill("exterior.shots@example.com");
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await tap("ql-next");
    await expect(page.getByTestId("wzm-gate")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await shot("11-gate");
    await page.getByTestId("gate-included").locator("summary").tap(); await shot("11-gate-rows");
    await tap("gate-bar-exact"); await at("w-front"); await shot("12-walk-front");
    await tap("ext-size-adj"); await shot("12-walk-adjust");
    await tap("ext-size-yes"); await tap("ext-cond-good"); await tap("ext-check-side"); await at("w-right");
    for (const s of ["w-right", "w-back", "w-left"]) { await at(s); await tap("ext-size-yes"); await tap("ext-cond-good"); await tap("ext-check-side"); }
    await at("w-done"); await shot("12-walk-done");
    await tap("ext-see-range");
    await expect(page.getByTestId("wzm-gate")).toHaveAttribute("data-variant", "tightened", { timeout: 90_000 });
    await shot("13-exact-price");
  });
});

export type { Page };
