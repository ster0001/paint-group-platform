import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, setStylesInEditor, openScopeEditor } from "./drive";
import { toSidesEditor } from "./exterior-v2-drive";

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
  await driveNoPlanWizard(page);
  /**
   * Doors only. WINDOWS are `defaultOn: false` on the rate card, so a default
   * interior job has none — and the editor's details card only asks about a
   * style it can actually price, which is the right behaviour. The old wizard
   * asked the window question regardless and stored an answer for a surface
   * nobody was painting; this is better, and the window-style path is covered
   * by openings-priced.spec.ts, which adds windows first.
   */
  await setStylesInEditor(page, { doorStyle: "Panel" });
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
  // Tom's walk ruling (31 Aug, trade batch 1): frames ARE architraves — the
  // seg offers exactly "door only" and "+ frame"; the "+ arch." option is
  // gone (legacy 'architrave' states still render as + frame).
  const doors = grid.locator(".sc-tl.on", { hasText: /^Doors/ }).first();
  await expect(doors).toBeVisible();
  const seg = doors.locator(".sd-wseg");
  await expect(seg).toBeVisible();
  await expect(seg.locator("button.on")).toHaveText("+ frame"); // today's default
  await expect(seg.getByRole("button", { name: "+ arch." })).toHaveCount(0);
  // Door-only takes the frame off; + frame puts it back — both reprice.
  await seg.getByRole("button", { name: "Door", exact: true }).click();
  await expect(seg.locator("button.on")).toHaveText("Door", { timeout: 25_000 });
  await seg.getByRole("button", { name: "+ frame" }).click();
  await expect(seg.locator("button.on")).toHaveText("+ frame", { timeout: 25_000 });

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
  // v2 phase 2: the job type is a chip on the quick look's first screen, and
  // the answer reaches the state as it is tapped — so the upload route it hands
  // to offers facade photos and a listing, never a floorplan.
  // Tom, 25 Oct 2026: the old upload route is staff-only — the editor is reached from the drawn house's range (Tighten).
  await toSidesEditor(page, { email: `e2e-ext-${Date.now()}@example.com` });

  // The CTA never offers an online accept — an estimator signs every
  // exterior job off (Tom, 21 Aug).
  const cta = page.locator(".sd-cta");
  await expect(cta).toBeVisible();
  await expect(cta).not.toHaveText(/Accept estimate/);
  // Tom, 14 Sep (item 1): no tier sentence in the strip — two buttons only.
  await expect(cta).toHaveText("Finalise my price");
  await expect(page.getByTestId("scope-book")).toBeVisible();

  // Tom, 25 Oct 2026: the rest of this test (open a side → "Yes" → take a tile off) was the
  // old route's editor, where a side arrived undecided. On the drawn house every side arrives
  // decided; the sides editor's own mechanics are exterior-v2-tighten.spec.ts.
});

// Tom's walk ruling (31 Aug, trade batch 1): frames ARE architraves — the
// "+ architrave" wizard answer is gone. The frame answer must still travel.
test("the wizard's 'Door + frame' answer reaches the estimate on every door tile", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page);
  await setStylesInEditor(page, { doorStyle: "Flat" });
  await openScopeEditor(page);

  const withDoors = page.locator(".sc-rc[data-room]").filter({ has: page.locator(".sc-tl.on", { hasText: /^Doors/ }) });
  expect(await withDoors.count()).toBeGreaterThan(0);
  const room = withDoors.first();
  await room.scrollIntoViewIfNeeded();
  await expect(room.locator(".sc-tl.on", { hasText: /^Doors/ }).locator(".sd-wseg button.on")).toHaveText("+ frame");
});
