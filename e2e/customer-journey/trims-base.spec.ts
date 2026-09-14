/**
 * Tom, 14 Sep — the paint questions on the tighten screen.
 *
 * Trims on a colour change are two coats at the gate and three in the range.
 * "Water based or oil based?" then, for water or not sure, "what was it last
 * painted in?". Oil over anything (oil over oil included) is two coats and
 * closes the question; "not sure what is underneath" stays at two coats,
 * marks the trims line for a person, and tells the customer we'll check.
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

const parseRange = (text: string): [number, number] => {
  const m = text.replace(/,/g, "").match(/\$(\d+)\s*–\s*\$(\d+)/);
  if (!m) throw new Error(`no range in "${text}"`);
  return [Number(m[1]), Number(m[2])];
};

async function toEditor(page: import("@playwright/test").Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page); // the place, defaults
  await quickNext(page); // the job: every tile ticked
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  // The reveal names the two-coat assumption and the three doors sit above it.
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed-trims")).toContainText(/two coats/i);
  await expect(page.getByTestId("reveal-open-trims")).toBeVisible();
  const doors = await page.getByTestId("door-tighten").boundingBox();
  const assumed = await page.getByTestId("reveal-assumed-toggle").boundingBox();
  expect(doors!.y).toBeLessThan(assumed!.y);
  await page.getByTestId("door-tighten").click();
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("details-paint-base")).toBeVisible({ timeout: 30_000 });
}

test("oil-based new paint closes the question at two coats and narrows the range", async ({ page }) => {
  test.setTimeout(240_000);
  await toEditor(page);
  const range = page.locator(".sc-r").first();
  await expect(range).toContainText(MONEY_RANGE, { timeout: 30_000 });
  const [lo0, hi0] = parseRange((await range.textContent()) ?? "");
  await page.getByTestId("details-paint-base").getByRole("button", { name: "Oil based", exact: true }).click();
  await expect(page.getByTestId("details-paint-base")).toHaveCount(0, { timeout: 30_000 });
  // No second question for oil, no marker, two coats in the panel.
  await expect(page.getByTestId("details-trims-current")).toHaveCount(0);
  const trims = page.getByTestId("what-we-do").getByTestId("what-we-do-trims");
  await expect(trims).toHaveAttribute("data-coats", "2");
  await expect(trims).not.toContainText(/a person confirms/i);
  // Tom, 14 Sep (items 10/11): the words say what was priced — oil-based, two coats.
  await expect(trims).toContainText(/two coats of oil-based enamel/i, { timeout: 30_000 });
  await expect(page.getByTestId("what-we-do").getByTestId("what-we-do-doors")).toContainText(/mask off or remove hardware, followed by two coats of oil-based enamel/i);
  await expect.poll(async () => parseRange((await range.textContent()) ?? "")[1], { timeout: 30_000 }).toBeLessThan(hi0);
  expect(parseRange((await range.textContent()) ?? "")[0]).toBeGreaterThanOrEqual(lo0);
});

test("water based over not-sure stays at two coats, marks the line for a person and says we'll check", async ({ page }) => {
  test.setTimeout(240_000);
  await toEditor(page);
  await page.getByTestId("details-paint-base").getByRole("button", { name: "Water based", exact: true }).click();
  const current = page.getByTestId("details-trims-current");
  await expect(current).toBeVisible({ timeout: 30_000 });
  await expect(current).toContainText(/shinier/i);
  await current.getByRole("button", { name: "Not sure", exact: true }).click();
  await expect(page.getByTestId("details-trims-check")).toContainText(/estimator to check/i, { timeout: 30_000 });
  await expect(current).toHaveCount(0);
  const trims = page.getByTestId("what-we-do").getByTestId("what-we-do-trims");
  await expect(trims).toHaveAttribute("data-coats", "2");
  await expect(trims).toContainText(/a person confirms this one/i);
  await expect(page.getByTestId("what-we-do-note-trims")).toHaveCount(0);
});
