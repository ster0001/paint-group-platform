/**
 * Tom, 7 Oct 2026 — the estimator wizard batch, driven as an anonymous customer:
 *  4 + 6. the cupboard questions start answered — kitchen No, built-in robe doors Yes (2);
 *  7. "Add room" with only a typed name adds it (the kind is read off the words), and the
 *     new room opens straight away with its size boxes ready — no scrolling to find it;
 *  5. a typed "Walk in robe" sizes at 2 × 1.25 m;
 *  8. a room takes its own ceiling height, and the job-wide height chip leaves it alone;
 *  1. with a floorplan uploaded, the rooms step shows a READING panel until the plan is read
 *     (never the guessed list), with a way past it. Needs the (gitignored) regression plan.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { driveNoPlanWizard, fillQuickAddress, openQuickLook, openScopeEditor, quickNext } from "./drive";

const cardNamed = (page: Page, name: string) => page.locator(".sc-rc[data-room]", { has: page.getByLabel(`Rename ${name}`, { exact: true }) }).first();
const openCard = async (card: ReturnType<typeof cardNamed>) => { await card.locator(".il-hd").click().catch(() => undefined); };

test("cupboards start answered: the kitchen's No and a bedroom's Yes (2 robe doors) are on before anyone taps", async ({ page }) => {
  test.setTimeout(240_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const kitchen = cardNamed(page, "Kitchen / Meals"); // the no-plan starter list's name for the kitchen
  await expect(kitchen).toBeVisible();
  await openCard(kitchen);
  const kCup = kitchen.locator(".il-cup").first();
  await expect(kCup).toContainText(/kitchen cupboards/i);
  await expect(kCup).toHaveClass(/ok/);
  await expect(kCup.getByRole("button", { name: "No", exact: true })).toHaveClass(/on/);
  const bed = page.locator(".sc-rc[data-room]", { has: page.locator("[aria-label*='edroom']") }).first();
  await openCard(bed);
  const bCup = bed.locator(".il-cup").first();
  await expect(bCup).toContainText(/robe doors/i);
  await expect(bCup).toHaveClass(/ok/);
  await expect(bCup.getByRole("button", { name: "Yes", exact: true })).toHaveClass(/on/);
  await expect(bCup.locator("b")).toHaveText("2");
  // One tap changes it — the default is an answer, not a lock.
  await bCup.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(bCup.getByRole("button", { name: "No", exact: true })).toHaveClass(/on/);
});

test("Add room by name alone opens the new room with its size boxes ready; a walk-in robe is 2 × 1.25 m; a room keeps its own ceiling height", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);
  const before = await page.locator(".sc-rc[data-room]").count();

  // 7 · the sweep's Add room: a typed name, no tile — the kind is guessed and shown.
  const sweep = page.locator('[data-card="sweep"]');
  await sweep.scrollIntoViewIfNeeded();
  // The last checks come one at a time: doors & windows first, then the rooms check.
  await sweep.getByTestId("check-dw-ok").click();
  await expect(sweep).toHaveAttribute("data-dw-done", "1", { timeout: 20_000 });
  await sweep.getByTestId("check-rooms-add").click();
  await expect(sweep.getByTestId("add-room-go")).toBeDisabled();
  await sweep.getByTestId("add-room-name").fill("Walk in robe");
  await expect(sweep.getByTestId("add-room-kind")).toContainText(/Sized as a .*Storage/i);
  await expect(sweep.getByTestId("add-room-go")).toBeEnabled();
  await sweep.getByTestId("add-room-go").click();

  // The newcomer is OPEN with its size form showing — no hunting for it.
  await expect(page.locator(".sc-rc[data-room]")).toHaveCount(before + 1, { timeout: 30_000 });
  const wir = cardNamed(page, "Walk in robe");
  await expect(wir).toBeVisible();
  const wirId = (await wir.getAttribute("data-room"))!;
  await expect(page.getByTestId(`size-form-${wirId}`)).toBeVisible({ timeout: 15_000 });
  // 5 · sized as a walk-in robe.
  await expect(wir.locator(".il-size").first()).toContainText("2 × 1.25 m");
  // And the card's name is in view (its header is inside the viewport), not off the bottom of the page.
  const box = await wir.locator(".il-hd").boundingBox();
  const vp = page.viewportSize()!;
  expect(box, "the new room's header is on screen").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThan(vp.height);

  // 8 · its own ceiling height, with the size.
  await page.getByTestId(`size-length-${wirId}`).fill("2.2");
  await page.getByTestId(`size-width-${wirId}`).fill("1.4");
  await page.getByTestId(`size-height-${wirId}`).fill("2.7");
  await page.getByTestId(`size-save-${wirId}`).click();
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
  await expect(wir.locator(".il-size").first()).toContainText("2.2 × 1.4 m · 2.7 m ceilings");
  // The job-wide height chip (asked once for every room) leaves this room's height alone.
  const heightChips = page.getByTestId("details-height");
  if (await heightChips.count()) {
    await heightChips.getByRole("button", { name: /2\.4 m/ }).click();
    await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });
    await expect(wir.locator(".il-size").first()).toContainText("2.7 m ceilings");
  }
});

const PLAN = "regression-set/plans/120 murrumbeena.jpg";
test("with a floorplan uploaded, the rooms step shows the reading panel until the plan is read — never a guessed list", async ({ page }) => {
  test.skip(!existsSync(PLAN), `regression plan not on this machine: ${PLAN}`);
  test.setTimeout(420_000);
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 30_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByTestId("ql-plan-upload").click()]);
  await chooser.setFiles(PLAN);
  await expect(page.getByTestId("ql-plan-upload")).toContainText(/Floorplan uploaded/i, { timeout: 240_000 });
  await quickNext(page);
  await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("ql-scope-whole").click();
  await page.getByTestId("ql-excl-none").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
  // Either the read has landed (plan tiles) or the reading panel is up — never the starter list.
  const panel = page.getByTestId("ql-plan-reading-panel");
  const tiles = page.locator("[data-testid^='ql-room-']:not([data-testid^='ql-room-added'])");
  await expect(panel.or(tiles.first())).toBeVisible({ timeout: 30_000 });
  if (await panel.count()) {
    await expect(page.getByTestId("ql-plan-reading")).toHaveCount(0); // the old "list below is from your answers" hint is gone
    await expect(panel).toContainText(/Reading|Finding the rooms/i);
  }
  // The plan's rooms arrive, and the preview is the zoomable viewer.
  await expect(tiles.first()).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("ql-plan-preview").getByRole("button", { name: "Zoom in" })).toBeVisible();
  // Nothing off the plan is a carport, sauna or store room.
  const names = (await tiles.allInnerTexts()).map((t) => t.trim().toLowerCase());
  for (const n of names) expect(n, "never painted off a plan").not.toMatch(/\b(carport|sauna)\b|\bstor(e|age|eroom)s?\b/);
});
