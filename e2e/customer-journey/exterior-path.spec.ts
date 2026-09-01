import { test, expect } from "@playwright/test";
import { MONEY_RANGE } from "./drive";

/**
 * R2 — the exterior wizard path (diagnostic #7: "exterior asks interior
 * questions"). The wizard BRANCHES at job type:
 *
 *   p1 address + listing/facade photos (no floorplan field — R1.3)
 *   p2 storeys + what's the building made of (seeds the editor's wall tiles)
 *   p3 what are we painting (roofline PRE-TICKED; NO "how far around" —
 *      side selection in the editor replaces it)
 *   p4 condition (peeling + pre-1970 → lead hard stop) + access
 *   p5 extras + paint preferences
 *
 * An exterior customer never sees ceiling heights, interior door styles or
 * the interior damage-photo intake.
 */

test("R2 exterior journey: five exterior pages, no interior questions, priced by sides", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/estimate");

  // Page 1 — exterior with a listing as the visual evidence.
  await page.getByRole("button", { name: "Exterior", exact: true }).click();
  await page.getByPlaceholder(/listing URL/).fill("https://www.realestate.com.au/property-house-vic-murrumbeena-1400001");
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

  // Page 2 — the house questions (the contact page moved to the END, Tom 31 Aug).
  await next();
  await expect(page.getByText(/What.s the building made of/i)).toBeVisible();
  await expect(page.locator(".wz-step")).toContainText(/storey/i);
  // Tom, 29 Aug: each storey answer says the height it means.
  await expect(page.locator(".wz-step")).toContainText(/up to 4 metres/i);
  await expect(page.locator(".wz-step")).toContainText(/over 4 metres/i);
  // Weatherboard rides pre-ticked from the default; the answer seeds the
  // editor's wall tiles.
  await expect(page.locator(".wz-tile.on", { hasText: "Weatherboard" })).toBeVisible();

  // Page 3 — what are we painting. Roofline pre-ticked; no extent question.
  await next();
  await expect(page.getByText(/What are we painting/i)).toBeVisible();
  await expect(page.locator(".wz-tile.on", { hasText: /Roofline|Fascias/i }).first()).toBeVisible();
  await expect(page.getByText(/How far around/i)).toHaveCount(0);

  // Page 4 — condition + access. NO interior questions.
  await next();
  await expect(page.getByText(/holding up|condition/i).first()).toBeVisible();
  await expect(page.getByText("Ceiling height")).toHaveCount(0);
  await expect(page.getByText(/What type of doors/)).toHaveCount(0);
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await page.getByRole("button", { name: /None of these/i }).click();
  // Tom, 29 Aug: special access equipment — asked here, and the moment one is
  // ticked the screen promises that none of it is priced in this session.
  await expect(page.getByText(/special access equipment/i)).toBeVisible();
  await expect(page.getByText(/No access equipment costs/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Scissor lift/i }).click();
  await expect(page.getByText(/No access equipment costs are included/i)).toBeVisible();
  await expect(page.getByText(/your estimator will confirm/i)).toBeVisible();

  // Page 5 — extras + paint prefs.
  await next();
  await expect(page.getByText(/Anything else out there|extras/i).first()).toBeVisible();
  await expect(page.locator(".wz-step")).toContainText(/Dulux|Haymes/);

  // The contact page (the LAST question) → submit → a priced result by sides.
  await next();
  const contact = page.locator(".wz-crow input");
  await expect(contact.first()).toBeVisible();
  await contact.nth(0).fill("E2E Exterior");
  await contact.nth(1).fill(`e2e-exterior-${Date.now()}@example.com`);
  await contact.nth(2).fill("0400 000 222");
  await page.getByRole("button", { name: "See my estimate" }).click();
  // 28 Aug: the wizard lands straight in the editor.
  await expect(page.locator(".sc-r").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE);
  // The sides editor renders sd-* cards, not the interior loop's wz-rooms —
  // the stale selector failed a journey that had actually succeeded.
  await expect(page.getByText(/Front — street side/).first()).toBeVisible();
});
