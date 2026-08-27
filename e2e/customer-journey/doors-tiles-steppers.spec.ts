import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, openScopeEditor } from "./drive";

/**
 * Tom's 21 Aug batch, driven on the real screen.
 *
 *  1. "It only lists doors, without frames" — the Doors tile now carries a
 *     Door · + frame · + architrave segment, and "+ architrave" produces a
 *     real, visible, priced architrave line.
 *  2. "When I click in the WC, skirting boards weren't available to add …
 *     please can these always be included in the tiles", and "if doors aren't
 *     included in the main estimate, they're not coming up in the tile" —
 *     every room shows the core surfaces as tiles, whatever its scope rules
 *     say, and an OFF tile adds the surface when tapped.
 *  3. "Make the size question stand out."
 *  4. "I chose winder window and it gave me awning casement in the builder."
 *  5. "Doors move quickly, but windows don't" — the window-group and cupboard
 *     steppers move on the tap, like the tile stepper.
 */

test("doors carry their frame/architrave answer, core tiles are always there, and every stepper moves on the tap", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page, { doorStyle: "Panel", windowStyle: "Winder" });
  await openScopeEditor(page);

  // ---- the size question leads the card ------------------------------------
  const first = page.locator(".sc-rc[data-room]").first();
  await first.scrollIntoViewIfNeeded();
  const sizeQ = first.locator(".il-q.il-first");
  await expect(sizeQ).toBeVisible();
  await expect(sizeQ.locator(".il-kick")).toHaveText(/FIRST — THE SIZE OF THIS ROOM/);
  // It settles once answered, so a finished room stops shouting.
  await expect(sizeQ).not.toHaveClass(/ok/);
  await sizeQ.getByRole("button", { name: "Looks right" }).click();
  await expect(sizeQ).toHaveClass(/ok/, { timeout: 20_000 });

  // ---- every room offers the core surfaces as tiles -------------------------
  // Including the ones this room type's rules never mention. An OFF tile is
  // a real control: tapping it adds the surface.
  const grid = first.locator(".sc-tgrid").first();
  for (const label of ["Walls", "Ceilings", "Skirting boards", "Doors", "Architraves"]) {
    await expect(grid.locator(".sc-tl", { hasText: new RegExp(`^${label}`) }).first()).toBeVisible();
  }

  // ---- the door tile says what comes with each door -------------------------
  const doors = grid.locator(".sc-tl.on", { hasText: /^Doors/ }).first();
  await expect(doors).toBeVisible();
  const seg = doors.locator(".sd-wseg");
  await expect(seg).toBeVisible();
  await expect(seg.locator("button.on")).toHaveText("+ frame"); // today's default
  await seg.getByRole("button", { name: "+ arch." }).click();
  // The architrave arrives as its OWN visible tile — never a hidden loading.
  const arch = first.locator(".sc-tl.on", { hasText: /^Architraves/ });
  await expect(arch).toBeVisible({ timeout: 25_000 });
  await expect(seg.locator("button.on")).toHaveText("+ arch.");
  // And back again takes it off.
  await seg.getByRole("button", { name: "+ frame" }).click();
  await expect(first.locator(".sc-tl.on", { hasText: /^Architraves/ })).toHaveCount(0, { timeout: 25_000 });

  // ---- a Winder answer stays a winder ---------------------------------------
  // The window group tile is labelled from the wizard answer, not from the
  // rate row it happens to price under.
  await first.getByRole("button", { name: /\+ Add a surface/ }).click();
  const panel = first.locator(".sd-addpanel");
  await panel.getByRole("button", { name: /More windows — a different size/ }).click();
  const group = first.locator(".sc-tl", { hasText: /More windows/ });
  await expect(group).toBeVisible({ timeout: 25_000 });

  // ---- every +/- moves on the tap -------------------------------------------
  // Three quick taps on the window group's stepper: the number must reach 4
  // immediately, not crawl one round-trip at a time (and none may be lost).
  const plus = group.locator(".sc-st button", { hasText: "+" });
  await plus.click();
  await plus.click();
  await plus.click();
  await expect(group.locator(".sc-st b")).toHaveText("4", { timeout: 3_000 });
  // …and it is still 4 once the save has landed.
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 40_000 });
  await expect(group.locator(".sc-st b")).toHaveText("4");
});

test("exterior: every item can be taken off, and there is no accept-online button", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/estimate");
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
  await next(); // → the house
  await next(); // → what are we painting
  await next(); // → condition + access
  await page.getByRole("button", { name: /Good overall/i }).click();
  await answer(/built before 1970/, "No");
  await page.getByRole("button", { name: /None of these/i }).click();
  await next(); // → extras + paint
  await next(); // → email gate
  const email = page.locator("input[type=email]");
  if (await email.count()) await email.fill(`e2e-ext-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "See my estimate" }).click();
  // 28 Aug: the wizard lands straight in the confirm-loop editor.
  await expect(page.locator(".sc-r").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });

  // The CTA never offers an online accept — an estimator signs every
  // exterior job off (Tom, 21 Aug).
  const cta = page.locator(".sd-cta");
  await expect(cta).toBeVisible();
  await expect(cta).not.toHaveText(/Accept estimate/);
  await expect(page.locator(".sd-tier")).toContainText(/signed off by your estimator|visit/i);

  // Every tile on an open side carries a remove control. (The tiles only
  // appear once the side is IN — "Are we painting this side?" comes first.)
  const side = page.locator(".sd-card.open").first();
  await side.getByRole("button", { name: "Yes", exact: true }).click();
  const removable = side.locator(".sd-tl.has-x .sd-x");
  await expect(removable.first()).toBeVisible({ timeout: 25_000 });
  expect(await removable.count()).toBeGreaterThan(0);
  // Take an "also on this side" tile off (not a wall — a wall's share has to
  // be rebalanced, and the last one can't go at all).
  const tiles = side.locator(".sd-tl.has-x").filter({ hasNot: page.locator(".sd-pcts, .sd-wseg") });
  const before = await tiles.count();
  expect(before).toBeGreaterThan(0);
  const tile = tiles.first();
  // The × is the tile's first text node, so read the label off the element.
  const label = (await tile.evaluate((el) => (el.lastChild?.textContent ?? el.textContent ?? "")))
    .replace(/×/g, "").trim();
  expect(label.length).toBeGreaterThan(0);
  await tile.locator(".sd-x").click();
  await expect(tiles).toHaveCount(before - 1, { timeout: 25_000 });
  await expect(side.locator(".sd-tl", { hasText: label })).toHaveCount(0);
});

test("the wizard's '+ architrave' answer reaches the estimate as a real architrave line", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page, { doorStyle: "Flat", doorScope: "+ architrave" });
  await openScopeEditor(page);

  // Every room that carries doors carries the architraves that go with them,
  // as their own visible tile — and the door tile agrees.
  const withDoors = page.locator(".sc-rc[data-room]").filter({ has: page.locator(".sc-tl.on", { hasText: /^Doors/ }) });
  expect(await withDoors.count()).toBeGreaterThan(0);
  const room = withDoors.first();
  await room.scrollIntoViewIfNeeded();
  await expect(room.locator(".sc-tl.on", { hasText: /^Architraves/ })).toBeVisible();
  await expect(room.locator(".sc-tl.on", { hasText: /^Doors/ }).locator(".sd-wseg button.on")).toHaveText("+ arch.");
});
