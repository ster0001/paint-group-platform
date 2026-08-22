import { test, expect } from "@playwright/test";
import { credentials, missingCreds, signIn } from "./helpers";
import { driveNoPlanWizard, openScopeEditor } from "./customer-journey/drive";

/**
 * Tom's 23 Aug batch, driven on the real screens.
 *
 *  1. Settings → Pricing & job numbers could not be saved at all: the folder
 *     swept up whole config objects (wizard_policy, wo_loop…), coerced them to
 *     NaN, and JSON null failed the NOT NULL column, taking every other row in
 *     the same upsert with it.
 *  2. Deleting an estimate now takes the row off screen at once.
 *  3. The staff sidebar is a drawer on a phone.
 *  4. Balustrades are a tile, not something buried in the add panel.
 *  5. Capture can record plastering and raw-timber hours with a note of where.
 */

const staff = credentials("STAFF");

test.describe("staff screens", () => {
  test.skip(!staff, missingCreds("STAFF"));

  test("the pricing settings save, and only numbers are offered", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings");
    await page.getByText("Pricing & job numbers").click();

    const fields = page.locator("label:has(input[type=number])");
    await expect(fields.first()).toBeVisible();
    const labels = (await fields.allTextContents()).join(" | ");

    // The three figures Tom wanted to update are all there, with their units.
    expect(labels).toContain("Weekly marketing");
    expect(labels).toContain("Weekly fixed costs");
    expect(labels).toContain("Overhead per billable hour");
    // And the config objects that broke the save are NOT.
    for (const key of ["wizard_policy", "wo_loop", "service_area", "wizard_public"]) {
      expect(labels).not.toContain(key);
    }

    // Saving the same values back is the honest test: it exercises the whole
    // upsert without changing a single one of Tom's numbers.
    await page.getByRole("button", { name: /save all/i }).click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/violates|null value/i)).toHaveCount(0);
  });

  test("a deleted estimate leaves the list at once", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);

    // Make one to delete, so nothing real is touched. "New estimate" asks how
    // first; a blank one is the quickest draft.
    await page.getByRole("button", { name: /New estimate/i }).first().click();
    await page.getByRole("link", { name: /Blank estimate/i }).click();
    await expect(page).toHaveURL(/\/quote/, { timeout: 20_000 });
    await page.waitForTimeout(4000); // the draft saves itself
    await page.goto("/estimates");

    const row = page.locator("tbody tr").first();
    const before = await page.locator("tbody tr").count();

    await row.getByRole("button", { name: /^Delete/ }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();

    // No round trip: the row is gone on the next frame, not in three seconds.
    // (Titles repeat across the list, so the COUNT is what proves it.)
    await expect(page.locator("tbody tr")).toHaveCount(before - 1, { timeout: 1500 });

    // And it stays gone — a refusal would have put it back with a reason.
    await page.waitForTimeout(4000);
    await expect(page.locator("tbody tr")).toHaveCount(before - 1);
    await expect(page.getByText(/couldn.t be deleted/i)).toHaveCount(0);
  });

  test("the sidebar is a drawer on a phone", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/estimates");

    // Shut by default, and the page gets the whole width.
    const nav = page.locator("#staff-nav");
    await expect(nav).not.toBeInViewport();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(nav).toBeInViewport();
    await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();

    // Tapping a link closes it rather than leaving it over the page.
    await nav.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 20_000 });
    await expect(nav).not.toBeInViewport();
  });

  test("capture records plastering and raw timber, and they reach the estimate", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/estimates");

    // Any estimate that still has a Capture link and at least one room in it —
    // accepted estimates get no link, and a blank draft has nothing to open.
    const links = await page.locator('a[href^="/quote/capture?id="]')
      .evaluateAll((els) => els.slice(0, 8).map((e) => (e as HTMLAnchorElement).getAttribute("href")!));
    test.skip(links.length === 0, "no un-accepted estimate to capture into");

    let estimateId = "";
    const room = page.locator("button").filter({ hasText: /surfaces · \$/ }).first();
    for (const href of links) {
      const id = new URL(href, "http://localhost").searchParams.get("id")!;
      await page.goto(`/quote/capture?id=${id}`);
      const start = page.getByRole("button", { name: "Start capturing" });
      if (await start.count()) await start.click();
      if (await room.count()) { estimateId = id; break; }
    }
    test.skip(estimateId === "", "no estimate with a captured room to open");
    await room.click();
    await page.getByRole("button", { name: /Done — review/ }).click();

    // The controls live on the room's own prep/notes step.
    const block = page.getByTestId("room-allowances");
    await expect(block).toBeVisible({ timeout: 20_000 });
    const hours = block.locator("input[type=number]");
    const wheres = block.locator("input:not([type=number])");
    await hours.nth(0).fill("2.5");
    await wheres.nth(0).fill("hallway ceiling crack");
    await hours.nth(1).fill("1");
    await wheres.nth(1).fill("new architraves");

    // Committing the room sends it to the builder. This is the step that used
    // to lose them: the route's schema strips anything it doesn't name, so the
    // allowances arrived and were silently dropped.
    await page.getByRole("button", { name: /Next room/ }).click();
    await page.waitForTimeout(7000);

    await page.goto(`/quote?id=${estimateId}`);
    // Both lines are on the estimate — hours at the charge-out rate, never a
    // silent $0, and the "where" travels with them to the work order.
    await expect(page.getByText("Plastering").first()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/Raw timber/i).first()).toBeVisible();
  });
});

test("balustrades are a tile in the customer editor, and they price", async ({ page }) => {
  test.setTimeout(300_000);
  await driveNoPlanWizard(page);
  await openScopeEditor(page);

  const room = page.locator(".sc-rc[data-room]").first();
  await room.scrollIntoViewIfNeeded();

  // In the grid with Walls and Ceilings — not buried in "+ Add a surface".
  const tile = room.locator(".sc-tl", { hasText: /Balustrades & hand rails/ }).first();
  await expect(tile).toBeVisible();
  await expect(tile).not.toHaveClass(/\bon\b/);

  const before = await page.locator(".sc-r").first().innerText();
  await tile.click();
  await expect(tile).toHaveClass(/\bon\b/, { timeout: 25_000 });
  // The tile goes on optimistically, so wait for the SAVE to land before
  // reloading — otherwise this races the write and tests nothing.
  await expect(page.locator(".sd-saving")).toHaveCount(0, { timeout: 30_000 });

  // It survives a reload, and it changed the price — never a silent $0 tick.
  await page.reload();
  await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
  const after = page.locator(".sc-rc[data-room]").first()
    .locator(".sc-tl", { hasText: /Balustrades & hand rails/ }).first();
  await expect(after).toHaveClass(/\bon\b/);
  await expect(page.locator(".sc-r").first()).not.toHaveText(before);
});
