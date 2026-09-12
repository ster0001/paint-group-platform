import { test, expect, type Page } from "@playwright/test";
import { openQuickLook, fillQuickAddress } from "./drive";

/**
 * C4 — audit 9.3 and 9.4, driven as the anonymous customer.
 *
 * 9.3(a) the commercial hand-off ran on EVERY Continue, and `?mode=business`
 *        seeds `propertyKind = "commercial"` before the first render — so a
 *        business visitor promised four screens got one, with no explanation.
 * 9.3(b) "Four quick screens" was typed, and false for Outside (three) and
 *        Both (five).
 * 9.3(c) Outside + Commercial then landed on PageExteriorHouse — an office
 *        block asked which weatherboards it has.
 *
 * The four job-type × kind combinations, on the real screens. Unit tests pin
 * the table; only this pins the wiring.
 */

async function startAt(page: Page, jobType: "interior" | "exterior" | "both", url = "/estimate") {
  await page.goto(url);
  await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 30_000 });
  await fillQuickAddress(page, { suburb: "Richmond" });
  await page.getByTestId(`ql-jobtype-${jobType}`).click();
}

async function toPlace(page: Page) {
  await page.getByTestId("ql-next").click();
  // C8: a "both" job meets the choice screen first — price them yourself.
  const both = page.getByTestId("ql-both-self");
  if (await both.count()) await both.click();
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 30_000 });
}

test("9.3(b) the screen-1 promise counts the real screens on every branch", async ({ page }) => {
  test.setTimeout(120_000);
  await openQuickLook(page);
  const sub = page.locator(".wz-quick .wz-sub").first();

  await page.getByTestId("ql-jobtype-interior").click();
  await expect(sub).toContainText("Four quick screens");

  await page.getByTestId("ql-jobtype-exterior").click();
  await expect(sub).toContainText("Three quick screens");

  await page.getByTestId("ql-jobtype-both").click();
  await expect(sub).toContainText("Five quick screens");
});

test("9.3(a) a ?mode=business visitor still sees the quick look", async ({ page }) => {
  test.setTimeout(120_000);
  // propertyKind is seeded commercial before the first render. The first
  // Continue used to exit the quick look entirely.
  await page.goto("/estimate?mode=business");
  await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 30_000 });
  await fillQuickAddress(page, { suburb: "Richmond" });
  await page.getByTestId("ql-jobtype-interior").click();
  await page.getByTestId("ql-next").click();
  // Screen 2, not an exit.
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 30_000 });
});

test("home + inside reaches screen 3 of the quick look", async ({ page }) => {
  test.setTimeout(120_000);
  await startAt(page, "interior");
  await toPlace(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-3").click();
  await page.getByTestId("ql-next").click();
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
});

test("home + outside reaches the outside screen, and there are only three", async ({ page }) => {
  test.setTimeout(120_000);
  await startAt(page, "exterior");
  await toPlace(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-next").click();
  await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 30_000 });
});

test("commercial + inside leaves the quick look at the place step, into the question pages", async ({ page }) => {
  test.setTimeout(120_000);
  await startAt(page, "interior");
  await toPlace(page);
  await page.getByTestId("ql-kind-commercial").click();
  await page.getByTestId("ql-next").click();
  // Out of the quick look, into the page set where the segment question lives.
  await expect(page.locator("[data-quick-step]")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".wz-wrap")).toBeVisible();
});

test("9.3(c) commercial + outside reaches a hand-off, never domestic house questions", async ({ page }) => {
  test.setTimeout(120_000);
  await startAt(page, "exterior");
  await toPlace(page);
  await page.getByTestId("ql-kind-commercial").click();
  await page.getByTestId("ql-next").click();

  // A person, with a reason — not "What we're painting" with house / fence /
  // deck / shed, and not a silent return to screen 1.
  await expect(page.getByText(/deserves a person/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/we price commercial work outside on site/i)).toBeVisible();
  await expect(page.locator("[data-quick-step='start']")).toHaveCount(0);
  await expect(page.getByText(/What we.re painting/i)).toHaveCount(0);
});

test("commercial + both reaches the same hand-off", async ({ page }) => {
  test.setTimeout(120_000);
  await startAt(page, "both");
  await toPlace(page);
  await page.getByTestId("ql-kind-commercial").click();
  await page.getByTestId("ql-next").click();
  await expect(page.getByText(/deserves a person/i)).toBeVisible({ timeout: 30_000 });
});
