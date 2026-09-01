import { test, expect } from "@playwright/test";

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

test("the plan panel is big enough to read, and opens bigger still", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.goto("/estimate");

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Upload a floorplan/ }).click(),
  ]);
  await chooser.setFiles(PLAN);
  await expect(page.locator(".wz-upload")).toContainText(/Floorplan uploaded/i, { timeout: 240_000 });

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
  for (let i = 0; i < 7; i++) {
    if (await page.locator(".sc-r").count()) break;
    // The contact page is the LAST page now (Tom, 31 Aug) — fill it when it
    // appears; the loop's next click is "See my estimate".
    const contact = page.locator(".wz-crow input");
    if (await contact.count()) {
      await contact.nth(0).fill("E2E Plan Panel");
      await contact.nth(1).fill(`e2e-plan-${Date.now()}@example.com`);
      await contact.nth(2).fill("0400 000 111");
    }
    const nav = page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ });
    if (!(await nav.count())) break; // submitted — the processing screen has no nav
    await nav.first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
    await page.waitForTimeout(600);
  }
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
