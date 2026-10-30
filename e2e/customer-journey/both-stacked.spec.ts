import { test, expect, type Page } from "@playwright/test";
import { MONEY_RANGE, driveNoPlanWizard } from "./drive";

/**
 * Batch 4 — "Both" jobs get the STACKED editor (Tom's ruling on the parity
 * audit): the interior confirm loop first, then the four sides + exterior
 * meta cards, ONE combined progress count, ONE CTA — and always the visit
 * tier in v1 (mixed scope needs eyes). The old element-grouped exterior
 * editor is DELETED — no estimate renders it any more; pre-rebuild
 * estimates get a polite start-again holding message instead.
 */

test("Both job: interior cards then sides, combined progress, single visit CTA", async ({ page }) => {
  test.setTimeout(300_000);
  /**
   * v2 phase 2: a both job walks the quick look and the outside is sized from
   * the answers (`noPhotos`) — which is what it always did. ⚑ It still does not
   * name its sides, so all four are priced; closing that needs the surfaces
   * model split by side (see quickNext's note in WizardApp).
   */
  await driveNoPlanWizard(page, { jobType: "both" });

  // BOTH structures on one page: interior room cards AND the four sides.
  const roomCards = page.locator(".sc-rc[data-room]");
  expect(await roomCards.count()).toBeGreaterThan(2);
  await expect(page.locator(".sd-card", { hasText: "Front" })).toBeVisible();
  await expect(page.locator('[data-side="last"]')).toBeVisible(); // 15 Sep (late): the last checks block

  // ONE combined progress: rooms + dw + sweep + 8 exterior items.
  const rooms = await roomCards.count();
  await expect(page.locator(".il-prog")).toContainText(`0 OF ${rooms + 2 + 8}`);

  // The old element-grouped exterior editor is GONE.
  await expect(page.locator(".sc-grouplbl")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Whole house" })).toHaveCount(0);

  // Single CTA; mixed scope is ALWAYS the visit tier, and it says so.
  const cta = page.locator(".il-cta");
  // Tom, 8 Sep (evening): the button is live from the start and says how much
  // is left; it hands a mixed job to a person, and never accepts one online.
  await expect(cta).toBeEnabled();
  await expect(cta).not.toHaveText(/Accept estimate/);
  // Tom, 14 Sep (item 1): the strip is two buttons — the human line is gone.
  await expect(page.getByTestId("scope-book")).toBeVisible();
  await expect(page.locator(".sc-stick button")).toHaveCount(2);
  await expect(page.locator(".sc-r")).toHaveText(MONEY_RANGE);
});

/**
 * EXTERIOR ON MOBILE v5 — session 7 (`docs/briefs/build-plan-exterior-mobile-v5.md`
 * §2 "Both" note; v2 brief 7.8), as an ANONYMOUS customer at 390 × 780 with
 * touch. A both job on a phone: the inside v5 screens, then the exterior
 * screens 2–9 with the strip turning into the drawn house, one details
 * screen, ONE gate carrying both ranges and both lists — and Get my exact
 * price opens the stacked editor (rooms then sides), as on the desktop.
 */
test.describe("on a phone: a both job is inside then outside, one gate (exterior mobile v5, session 7)", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const run = Math.random().toString(16).slice(2, 8);

  test("inside screens → the exterior screens with the house in the strip → details → one gate with both ranges → the stacked editor", async ({ page }) => {
    test.setTimeout(300_000);
    const { openQuickLook, fillQuickAddress, MONEY_RANGE } = await import("./drive");
    await openQuickLook(page);
    await fillQuickAddress(page, { suburb: `E2E S7 Both ${run}` });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-jobtype-both").tap();
    await at(page, "both");
    await page.getByTestId("ql-both-self").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-3").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await expect(page.getByTestId("wzm-thumb").locator("svg[data-testid='wzm-pic']")).toHaveAttribute("data-kind", "room");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-good").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    // the outside half: the shape, and the strip turns into the drawn house
    await at(page, "shape");
    await expect(page.getByTestId("wzm-stage")).toHaveText("Your home");
    await page.getByTestId("ql-ext-type-wb").tap();
    await at(page, "size");
    await expect(page.getByTestId("wzm-thumb").locator("svg.wz-elev")).toHaveAttribute("data-shape", "wb");
    await expect(page.getByTestId("wzm-ribbon-1")).toContainText("Inside and outside");
    await expect(page.getByTestId("wzm-ribbon-1")).toContainText("Weatherboard home");
    await page.getByTestId("ql-ext-size-md").tap();
    await at(page, "p-house");
    await page.getByTestId("ext-part-walls").tap();
    await page.getByTestId("ext-part-fascias").tap();
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("2 parts ticked · tap to see");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-win");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-ver");
    await page.getByTestId("ql-next").tap();
    await at(page, "p-around");
    await page.getByTestId("ql-next").tap();
    await at(page, "a-walls");
    await page.getByTestId("ext-mat-weatherboards").tap();
    await at(page, "a-colours");
    await page.getByTestId("ql-ext-colour-new").tap();
    await at(page, "a-access");
    await page.getByTestId("ql-next").tap();
    for (const s of ["s-front", "s-right", "s-back", "s-left"]) { await at(page, s); await page.getByTestId("ql-next").tap(); }
    // one details screen, then one gate
    await at(page, "details");
    await expect(page.locator(".wzm")).not.toContainText(/\$\s?\d/);
    await page.getByTestId("gate-name").fill("Seven Both");
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`s7b.${run}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect(page.getByTestId("gate-part-interior")).toContainText(MONEY_RANGE);
    await expect(page.getByTestId("gate-part-exterior")).toContainText(MONEY_RANGE);
    await expect(page.getByTestId("gate-basis")).toContainText(/Outside:/);
    await expect(page.getByTestId("gate-fine")).toContainText(/scaffolding or a lift/);
    await expect(page.getByTestId("gate-block-ask")).toContainText(/room by room, then side by side/);
    await expect(page.getByTestId("gate-exact")).toContainText("Inside, then outside");
    expect(await gate.innerText()).not.toMatch(/±|within \d+%|Guide ·|Detailed/);
    await page.getByTestId("gate-included").locator("summary").tap();
    await expect(page.getByTestId("gate-included-inside")).toBeVisible();
    await expect(page.getByTestId("gate-included-walls")).toBeVisible();
    await expect(page.getByTestId("gate-included-outside")).toBeVisible();
    await expect(page.getByTestId("ext-range-front")).toBeVisible();
    // Get my exact price on a both job: the stacked editor — rooms, then the sides
    await page.getByTestId("gate-bar-exact").tap();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 30_000 });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    expect(await page.locator(".sc-rc[data-room]").count()).toBeGreaterThan(2);
    await expect(page.locator(".sd-card", { hasText: "Front" })).toBeVisible({ timeout: 60_000 });
  });
});
