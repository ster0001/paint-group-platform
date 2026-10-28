import { expect } from "@playwright/test";
import { test } from "../helpers";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";

/**
 * Wizard mobile v5 — session 6 (brief §6, D14 = build): the roller sweep on
 * the DESKTOP room picture, as an anonymous customer at 1280px.
 *
 * Ticking a surface chip on the Job step sweeps that surface's paint in on
 * the picture beside the questions (the clip rect 0 → 400 with the roller
 * glyph riding the edge); unticking wipes it back; reduced motion snaps.
 * The state attributes the older specs read (`data-s`, `data-on`,
 * `data-bold`) are unchanged. No layout change.
 */
const width = (page: import("@playwright/test").Page, surf: string) =>
  page.locator(`[data-testid='pic-room'] [data-surf='${surf}'] rect.cprect`).evaluate((r) => Number(r.getAttribute("width")));

test("the desktop room: a chip sweeps its surface in and out, the glyph rides the edge, reduced motion snaps", async ({ page }) => {
  test.setTimeout(120_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 20_000 });
  const room = page.getByTestId("pic-room");
  // the whole interior: every surface painted, each layer fully in (the arrival sweep settles first)
  for (const s of ["walls", "ceilings", "skirting", "architraves", "doors", "windows"]) {
    await expect(room.locator(`[data-s='${s}']`).first()).toHaveAttribute("data-on", "1");
    await expect.poll(() => width(page, s), { timeout: 3_000 }).toBe(400);
  }
  // untick the ceilings: the wipe is under way, then gone; the glyph shows while it runs
  await page.getByTestId("ql-excl-ceilings").click();
  await expect(room.locator("[data-s='ceilings']").first()).toHaveAttribute("data-on", "0");
  await page.waitForTimeout(150);
  const mid = await width(page, "ceilings");
  expect(mid, "the wipe is under way, not a snap").toBeGreaterThan(0);
  expect(mid).toBeLessThan(400);
  await expect(room.locator("[data-surf='ceilings'] .roller")).toHaveClass(/on/);
  await expect.poll(() => width(page, "ceilings"), { timeout: 3_000 }).toBe(0);
  await expect(room.locator("[data-surf='ceilings'] .roller")).not.toHaveClass(/on/);
  // the walls are untouched by the ceilings' wipe
  expect(await width(page, "walls")).toBe(400);
  // tick it back: sweeps in
  await page.getByTestId("ql-excl-ceilings").click();
  await expect.poll(() => width(page, "ceilings"), { timeout: 3_000 }).toBe(400);
  // reduced motion: a snap
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("ql-excl-doors").click();
  await page.waitForTimeout(60);
  expect(await width(page, "doors")).toBe(0);
  await page.getByTestId("ql-excl-doors").click();
  await page.waitForTimeout(60);
  expect(await width(page, "doors")).toBe(400);
  // the Condition step shows the room as it is today: nothing painted, every layer out
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 20_000 });
  await expect(room).toHaveAttribute("data-today", "1");
  await expect.poll(() => width(page, "walls"), { timeout: 3_000 }).toBe(0);
});
