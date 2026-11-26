/**
 * 14 Sep — "Some rooms — you'll pick which ones next" now asks. The rooms
 * step sits after the job screen for that preset only; unticked rooms are
 * never seeded, so the range is honest from the first number and the editor
 * opens on the rooms the customer named.
 *
 * Desktop one-press (19 Nov 2026): on a laptop with the flag on the quick look is the phone's one-question shell —
 * the preset advances itself to the surfaces screen (no exclusions strip), and an empty rooms list disables
 * Continue with the reason on screen instead of an error after the tap. Both paths are driven here.
 */
import { test, expect } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, onMobileShell, openQuickLook, quickNext, passGateIfShown, tightenToScope } from "./drive";

test("some rooms asks which rooms and seeds only those", async ({ page }) => {
  test.setTimeout(240_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await quickNext(page); // the place, defaults (3 beds)
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
  const shell = await onMobileShell(page);
  await page.getByTestId("ql-scope-some_rooms").click();
  // Tom, 14 Sep (evening): "anything NOT being painted?" pops up after the preset on the grouped laptop — nothing excluded here.
  if (!shell) await page.getByTestId("ql-excl-none").click();
  await quickNext(page); // (the shell: the surfaces screen's Continue)
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  // the listed rooms only — the shell adds unticked extras (Garage, …) after them, which a tap ADDS
  const tiles = page.locator("[data-testid^='ql-room-']:not([data-testid^='ql-room-extra-']):not([data-testid^='ql-room-added-'])");
  const n = await tiles.count();
  expect(n).toBeGreaterThan(4);
  // Set each tile, whatever it started as: the grouped laptop starts every room ticked; the shell's "Some rooms"
  // starts with none ("You pick which, next"). Every room but the last two, then. (Two bedrooms alone at two coats on
  // the trims price under the $2,000 floor and land on the "we'll price it directly" page — correct, not this journey.)
  const setOn = async (i: number, on: boolean) => {
    const t = tiles.nth(i);
    if ((await t.getAttribute("aria-pressed")) !== String(on)) await t.click();
    await expect(t).toHaveAttribute("aria-pressed", String(on));
  };
  for (let i = 0; i < n; i++) await setOn(i, i < n - 2);
  const kept = [await tiles.nth(0).innerText(), await tiles.nth(1).innerText()];
  // Nothing ticked is a gate, not a silent "all rooms".
  for (let i = 0; i < n; i++) await setOn(i, false);
  if (shell) {
    await expect(page.getByTestId("ql-why")).toContainText(/at least one room/i);
    await expect(page.getByTestId("ql-next")).toBeDisabled();
  } else {
    await expect(page.getByTestId("ql-rooms-none")).toBeVisible();
    await page.getByTestId("ql-next").click();
    await expect(page.getByTestId("ql-error")).toContainText(/at least one room/i);
  }
  for (let i = 0; i < n - 2; i++) await setOn(i, true);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='condition']")).toBeVisible({ timeout: 30_000 });
  await quickNext(page);
  await passGateIfShown(page); // S6: the details-first question sits before the range
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await tightenToScope(page);
  await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 60_000 });
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
  const names = page.locator("[data-testid^='room-rename-btn-']");
  await expect(names).toHaveCount(n - 2);
  for (const k of kept) await expect(page.getByLabel(`Rename ${k}`)).toBeVisible();
});
