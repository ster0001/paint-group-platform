import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";

/**
 * C11 — the human moments and the reveal.
 *
 * Tom's check: the estimator's real name appears on the reveal, tighten and
 * finish; the footer line changes after two not-sures. Accept: no "Book in
 * your estimator" heading or icon-tile row · the footer line derives from
 * state · tier labels over the one ladder.
 *
 * The name is whatever the test project's staff patch or Settings coordinator
 * says — the spec asserts the strip is the SAME on all three screens and never
 * invents a person: unnamed reads "Your estimator", never "Sarah".
 */
test("the estimator strip is on the reveal, the tighten screen and the finish line — the same person on all three", async ({ page }) => {
  test.setTimeout(300_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);
  await quickNext(page);
  await page.getByTestId("ql-condition-good").click();
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });

  const stripName = async () => (await page.getByTestId("estimator-name").first().textContent())!.trim();
  await expect(page.getByTestId("estimator-strip").first()).toBeVisible();
  const onReveal = await stripName();
  expect(onReveal).not.toMatch(/Sarah/); // the prototype's placeholder never reaches a customer
  // The reveal's tiers: Guide lit, by construction.
  await expect(page.getByTestId("reveal-tiers").locator("span.on")).toHaveText("Guide");

  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  await expect(page.getByTestId("estimator-strip").first()).toBeVisible({ timeout: 60_000 });
  expect(await stripName()).toBe(onReveal);
  // No banned heading, no icon-tile row.
  await expect(page.getByText("Book in your estimator")).toHaveCount(0);
  await expect(page.locator(".reach-b")).toHaveCount(0);
  // Tom, 14 Sep (item 1): the strip is two buttons; the estimator is in the frozen header.
  await expect(page.getByTestId("scope-book")).toBeVisible();
  await expect(page.locator(".sc-freeze").getByTestId("estimator-strip")).toBeVisible();
  await expect(page.getByTestId("cta-hint")).toHaveCount(0);

  // Finalise before everything is answered prompts them to finish (item 2); the finish line itself is reached directly here.
  await page.getByTestId("scope-finalise").click();
  await expect(page.getByTestId("finalise-prompt")).toBeVisible();
  await page.goto(`/estimate/finish?id=${new URL(page.url()).searchParams.get("id")}`);
  await page.waitForURL(/\/estimate\/finish/, { timeout: 60_000 });
  await expect(page.getByTestId("estimator-strip").first()).toBeVisible({ timeout: 60_000 });
  expect(await stripName()).toBe(onReveal);
  // The finish line's tier comes from the ladder, not a band number.
  await expect(page.getByTestId("finish-tiers")).toHaveAttribute("data-tier", /guide|detailed|confirmed/);
});

test("the footer line changes with the not-sures, and the offers appear at their moments", async ({ page }) => {
  test.setTimeout(300_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-house").click();
  await page.getByTestId("ql-bedrooms-2").click();
  await quickNext(page);
  await quickNext(page);
  await page.getByTestId("ql-condition-wear").click();
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });

  // Tom, 14 Sep (items 1, 12): no human line, no not-sures box — the details card asks.
  await expect(page.getByTestId("details-card")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("offer-not_sures")).toHaveCount(0);

  // Answer whatever the details card asks (door style, window style, height,
  // shiny): each answer retires a not-sure, and once fewer than two remain the
  // line moves on.
  // Tom, 14 Sep (item 5): one question at a time, in order.
  const details = page.getByTestId("details-card");
  for (const name of ["No", "Panel", "Casement", "Oil based", "2.7 m"]) {
    const b = details.getByRole("button", { name, exact: true });
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(800); }
  }

  // Tom, 14 Sep (item 21): "Adjust it" opens the measurements — no "measure it instead" box.
  const first = page.locator(".sc-rc[data-room]").first();
  await first.locator(".il-hd").click().catch(() => undefined);
  await first.getByRole("button", { name: /Adjust it/ }).click();
  await expect(first.getByTestId("offer-measure")).toHaveCount(0);
  await expect(first.getByPlaceholder(/length/i)).toBeVisible();

  // Pointing out a spot brings the "damage is easier in person" offer.
  const areaId = await first.getAttribute("data-room");
  await page.getByTestId(`spot-open-${areaId}`).click();
  await expect(page.getByTestId("offer-damage")).toBeVisible();
});
