import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";
import { existsSync } from "node:fs";

/**
 * The pinned floorplan, at a size you can actually read (Tom, 21 Aug:
 * "please can you make the floorplan view bigger" — the second time the plan's
 * visibility has come back, after R5 pinned it at all).
 *
 * This is the one spec that needs a REAL floorplan: everything the panel does
 * depends on there being a plan on file, so it uploads one from the regression
 * corpus and pays for one extraction. Worth it — the two bugs it caught were
 * both invisible to unit tests: the full-screen overlay rendered UNDERNEATH
 * the frozen header and the sticky footer (its ✕ CLOSE was unreachable), and
 * the overlay grew past the viewport because a flex item's min-height defaults
 * to its content.
 */

const PLAN = "regression-set/plans/120 murrumbeena.jpg";

// The plan is a real customer floorplan from the (gitignored) regression set —
// present on Tom's machines, absent on a CI runner. Skip there, never fabricate.
test("the plan panel is big enough to read, and opens bigger still", async ({ page }) => {
  test.skip(!existsSync(PLAN), `regression plan not on this machine: ${PLAN}`);
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1512, height: 900 });
  // Tom, 14 Sep: the floorplan is uploaded ON the quick look — the place
  // screen — and the rooms come off it; the old upload pages are gone for an
  // inside job.
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 30_000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("ql-plan-upload").click(),
  ]);
  await chooser.setFiles(PLAN);
  await expect(page.getByTestId("ql-plan-upload")).toContainText(/Floorplan uploaded/i, { timeout: 240_000 });
  await expect(page.getByTestId("ql-plan-done")).toBeVisible();
  await quickNext(page); // the job
  // The job step needs a SCOPE before it will move on, and a preset opens the
  // "anything NOT being painted?" strip (Tom, 14 Sep evening) — every other
  // journey spec taps both; this one called a bare Continue and sat on
  // "What's the job?" until the rooms assertion timed out. Whole interior: the
  // plan's rooms are what the next step confirms.
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ql-scope-whole").click();
  await page.getByTestId("ql-excl-none").click();
  await quickNext(page);
  // 14 Sep (evening): confirm the rooms — the plan's, once read; the starter list until then.
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page); // See my guide range — the plan's rooms, priced
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 240_000 });
  await page.getByTestId("door-tighten").click();

  // 28 Aug: the wizard lands straight in the editor.
  await expect(page.locator(".sc-r").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });

  // ---- the pinned column, at a readable size --------------------------------
  const frame = page.locator(".pp-side .wz-planframe");
  await expect(frame).toBeVisible();
  const pinned = (await frame.boundingBox())!;
  // It used to be a flat 340px column at every screen width. On a laptop the
  // frame is now half again as wide as that whole column was.
  expect(pinned.width).toBeGreaterThan(500);
  expect(pinned.height).toBeGreaterThan(300);
  // And the plan really is drawn, not a white box: the image decoded.
  const natural = await frame.locator("img").evaluate(async (el) => {
    const i = el as HTMLImageElement;
    await i.decode();
    return i.naturalWidth;
  });
  expect(natural).toBeGreaterThan(0);

  // ---- bigger still ---------------------------------------------------------
  await page.getByRole("button", { name: /Open the plan full screen/ }).click();
  const full = page.locator(".pp-full");
  await expect(full).toBeVisible();
  const big = (await full.locator(".wz-planframe").boundingBox())!;
  expect(big.width).toBeGreaterThan(pinned.width * 2);
  // It must FIT the window — a flex item sized by its content overflowed it.
  const vh = page.viewportSize()!.height;
  expect(big.y + big.height).toBeLessThanOrEqual(vh);

  // Nothing may paint over it — the frozen header and the sticky footer both
  // used to, which hid the close control.
  const onTop = await page.evaluate(() => {
    const at = (x: number, y: number) => document.elementFromPoint(x, y)?.className ?? "";
    return { header: at(innerWidth / 2, 60), footer: at(innerWidth / 2, innerHeight - 40) };
  });
  expect(onTop.header).not.toMatch(/sc-freeze/);
  expect(onTop.footer).not.toMatch(/sc-stick|sc-row/);

  await page.getByRole("button", { name: /Close the full-screen plan/ }).click();
  await expect(full).toHaveCount(0);

  // ---- and on a phone -------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 780 });
  await page.locator(".pp-peek").click();
  await expect(page.locator(".pp-sheet")).toBeVisible();
  await page.locator(".pp-sheet").getByRole("button", { name: /Open the plan full screen/ }).click();
  await expect(page.locator(".pp-full")).toBeVisible();
  const phone = (await page.locator(".pp-full .wz-planframe").boundingBox())!;
  expect(phone.y + phone.height).toBeLessThanOrEqual(780);
  await page.keyboard.press("Escape");
  await expect(page.locator(".pp-full")).toHaveCount(0);
});
