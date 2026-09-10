import { test, expect } from "@playwright/test";
import { driveNoPlanWizard, MONEY_RANGE } from "./drive";

/**
 * ⚑ REPLACES paint-systems-card.spec.ts, which tested a screen that is gone.
 *
 * Tom, 10 Sep: *"'How we'll paint each surface' needs to go — it doesn't provide
 * a great deal of value, the client has already confirmed if they want a colour
 * change, colour match or dark to light."* What survived is the one job-wide
 * question that genuinely changes coats, and the per-room prep question that
 * the exceptions actually live in.
 *
 * The DERIVATION is untouched — lib/pricing/systems.ts still works the coats out
 * per surface group, and its unit tests still cover that. This spec is about
 * what the customer is asked.
 */

test("a bold job picks its dark-to-light surfaces, and nothing else asks about coats", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "bold" });

  // The card that went.
  await expect(page.getByTestId("systems-card")).toHaveCount(0);
  await expect(page.getByText(/How we.ll paint each surface/i)).toHaveCount(0);

  // The one that replaced it — and only because this job is going bold.
  const card = page.getByTestId("darklight-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/dark to light/i);

  // Tom's own list: All walls · Some walls · Doors · Architraves · Skirting
  // boards · Window frames — plus ceilings, which get their own row below
  // because they are answered per room (Tom, 11 Sep).
  await expect(page.getByTestId("darklight-walls")).toContainText("All walls");
  await expect(page.getByTestId("darklight-some-walls")).toBeVisible();
  await expect(card).toContainText(/two coats as standard/i);
  await page.getByTestId("darklight-doors").click();
  await expect(page.getByTestId("darklight-doors")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE);

  /**
   * ⚑ NOT asserting that the range MOVES, and the reason is a conflict worth
   * seeing rather than papering over. Tom's 9 Sep coat table already gives a
   * bold job the heavier system on most groups — walls 3 (undercoat + 2), trims
   * 3, doors 3 — so ticking "walls are going dark to light" changes nothing,
   * because walls were already three coats. His 10 Sep instruction reads the
   * other way: ticked = 3, "everything else 2".
   *
   * Both cannot be true. Until Tom rules, the card records the answer honestly
   * and the table prices it — which is the safe direction, because it can only
   * ever quote the heavier system rather than the lighter one.
   */
});

/**
 * ⚑ Tom, 11 Sep: *"it isn't typical for a ceiling to go from dark to light — so
 * maybe it could be added to the dark to light as ceilings some rooms, or all
 * ceilings; if it's some rooms, then it adds an option to choose the rooms in
 * the room builder."*
 *
 * The per-room tick is the whole point, so that is what this drives: turn on
 * "some rooms", tick ONE room, and prove the others were not quietly lifted
 * with it.
 */
test("ceilings: all of them, or the rooms the customer names", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "bold" });

  const row = page.getByTestId("darklight-ceilings-row");
  await expect(row).toBeVisible();
  // Said out loud, because it is the reason the question is shaped this way.
  await expect(row).toContainText(/usually white over white/i);
  // No per-room tick until the job-wide answer asks for one — on most jobs this
  // never appears at all. (Checked with a room card OPEN, so an absent tick is
  // the answer rather than a collapsed card.)
  await page.locator(".sc-rc[data-room]").first().locator(".sc-hd").click();
  await expect(page.locator('[data-testid^="room-ceiling-d2l-"]')).toHaveCount(0);

  await page.getByTestId("darklight-ceilings-some").click();
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("darklight-ceilings-some-note")).toContainText(/quoted at the standard/i);

  /**
   * The tick lives INSIDE the room card, which opens one room at a time — the
   * same place, and the same rhythm, as every other per-room question (the size,
   * the cupboards, the spots). So this opens a room to answer it rather than
   * expecting every room to be showing at once.
   */
  const cards = page.locator(".sc-rc[data-room]");
  const openRoom = async (i: number) => {
    const card = cards.nth(i);
    await card.locator(".sc-hd").click();
    await card.scrollIntoViewIfNeeded();
    return card;
  };
  const first = await openRoom(0);
  const firstTick = first.locator('[data-testid^="room-ceiling-d2l-btn-"]');
  await expect(firstTick).toBeVisible();
  await firstTick.click();
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(firstTick).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("darklight-ceilings-some-note")).toContainText(/1 ceiling with the extra coat/i);
  await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE);

  // ⚑ The next room is UNTOUCHED — that is the whole point of "some rooms".
  const second = await openRoom(1);
  await expect(second.locator('[data-testid^="room-ceiling-d2l-btn-"]'))
    .toHaveAttribute("aria-pressed", "false");

  // It SURVIVES a reload — the answer is on the estimate, not in the tab.
  await page.reload();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  await expect(page.getByTestId("darklight-ceilings-some")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("darklight-ceilings-some-note")).toContainText(/1 ceiling with the extra coat/i);
  const again = await openRoom(0);
  await expect(again.locator('[data-testid^="room-ceiling-d2l-btn-"]'))
    .toHaveAttribute("aria-pressed", "true");

  // "All ceilings" replaces the room list rather than stacking on it — and the
  // per-room question disappears, because there is nothing left to choose.
  await page.getByTestId("darklight-ceilings-all").click();
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("darklight-ceilings-some-note")).toHaveCount(0);
  await expect(page.locator('[data-testid^="room-ceiling-d2l-"]')).toHaveCount(0);
});

test("a same-colour job is never asked which surfaces are going dark to light", async ({ page }) => {
  test.setTimeout(240_000);
  // There is nothing to pick on a colour match, and offering the choice would
  // invent a question the customer has already answered.
  await driveNoPlanWizard(page, { colour: "same" });
  await expect(page.getByTestId("darklight-card")).toHaveCount(0);
  await expect(page.getByTestId("systems-card")).toHaveCount(0);
});

test("the per-room prep question is worded by the job's colour intent", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page, { colour: "same" });
  const areaId = await page.locator("[data-room]").first().getAttribute("data-room");
  await page.locator(`[data-room="${areaId}"] .il-hd`).click();
  // A colour match asks about COVERAGE — what will not cover in one.
  await expect(page.getByTestId(`spot-open-${areaId}`)).toContainText(/extra work/i);
  await page.getByTestId(`spot-open-${areaId}`).click();
  await expect(page.getByTestId(`spot-panel-${areaId}`)).toContainText(/won.t cover in one/i);
});
