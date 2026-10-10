import { test, expect, type Page } from "@playwright/test";
import { driveNoPlanWizard, fillQuickAddress, MONEY_RANGE, openQuickLook, openScopeEditor, passGateIfShown, quickNext } from "./drive";

/**
 * Wizard UI refresh — "Nothing left behind" (brief §10; run sheet S8).
 *
 * Opens every customer-reachable row of §7.13 and §7.12 at 1440px, as an
 * anonymous customer, and fails if a screen still wears the OLD shell:
 *   · a header taller than 64px,
 *   · a single ~640px content column where the new layout has two (the
 *     question steps and the editors),
 *   · a full-width action bar fixed to the bottom of a laptop screen.
 * The end-of-journey screens (Sent, Booked, Book a time, the guardrail card,
 * the holding page) are single centred cards by design; for those the check
 * is the new card itself.
 *
 * Not here, by design: the trade lane (⚑ 20), the staff page list (⚑ 21),
 * the assistant page (⚑ 22, tokens only).
 */

const W = 1440;

async function head(page: Page): Promise<number> {
  const el = page.locator("[data-testid='wz-head'], .sc-freeze, header.wz-top").first();
  await expect(el).toBeVisible();
  return (await el.boundingBox())!.height;
}

/** No action bar pinned across the full width of a laptop screen. */
async function noFullBleedBar(page: Page) {
  const wide = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
    const s = getComputedStyle(el);
    if (s.position !== "fixed" || s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth - 2 && r.bottom >= window.innerHeight - 1 && r.height > 0 && r.height < 200 && !!el.querySelector("button, a");
  }).map((el) => el.className.toString()));
  expect(wide, "a full-width action bar pinned to the bottom").toEqual([]);
}

/** Two columns: the side (picture / rail) sits to the right of the content. */
async function twoColumns(page: Page, main: string, side: string) {
  const m = (await page.locator(main).first().boundingBox())!;
  const s = (await page.locator(side).first().boundingBox())!;
  expect(s.x, `${side} sits beside ${main}`).toBeGreaterThan(m.x + m.width - 1);
  expect(m.width).toBeGreaterThanOrEqual(560);
  expect(m.width).toBeLessThanOrEqual(760);
}

async function newShellStep(page: Page, step: string) {
  await expect(page.locator(`[data-quick-step='${step}']`)).toBeVisible({ timeout: 30_000 });
  expect(await head(page), `${step}: header`).toBeLessThanOrEqual(64);
  await twoColumns(page, "[data-quick-step]", "[data-testid='ql-side']");
  await noFullBleedBar(page);
}

test.describe("UI refresh · nothing left behind (1440px, as a customer)", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: W, height: 900 }); });

  test("home inside: the six steps, the range, the editor, the finalise prompt, Book a time, Finish, Sent", async ({ page }) => {
    test.setTimeout(420_000);
    await openQuickLook(page);
    await newShellStep(page, "start");
    await fillQuickAddress(page);
    await quickNext(page);
    await newShellStep(page, "place");
    await quickNext(page);
    await newShellStep(page, "job");
    await quickNext(page);
    await newShellStep(page, "rooms");
    await quickNext(page);
    await newShellStep(page, "condition");
    await quickNext(page);
    const gate = page.locator("[data-quick-step='gate']");
    await expect(gate.or(page.getByTestId("reveal"))).toBeVisible({ timeout: 90_000 });
    if (await gate.count()) await newShellStep(page, "gate");
    await passGateIfShown(page, { email: `ui.cover.${Date.now()}@example.com` });

    // The range: the new card and its doors, two columns.
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    expect(await head(page)).toBeLessThanOrEqual(64);
    await twoColumns(page, ".wz-rv-card", ".wz-rv-doors");
    await noFullBleedBar(page);

    // The editor: slim header, cards left, the rail right.
    await page.getByTestId("door-tighten").click();
    await openScopeEditor(page);
    expect(await head(page)).toBeLessThanOrEqual(64);
    await twoColumns(page, ".sc-ed > .sc-wrap", ".sc-rail");
    await noFullBleedBar(page);
    const id = new URL(page.url()).searchParams.get("id");
    expect(id).toBeTruthy();

    // The finalise prompt is a sheet from the right, never a full-page takeover.
    await page.getByTestId("scope-finalise").click();
    await expect(page.getByTestId("finalise-prompt")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400); // the sheet slides in (0.28s) — measure where it lands
    const sheet = (await page.locator("[data-testid='finalise-prompt'] .wz-sheet").boundingBox())!;
    expect(sheet.width).toBeLessThanOrEqual(480);
    expect(Math.round(sheet.x + sheet.width)).toBe(W);

    // Book a time: one centred card.
    await page.getByTestId("prompt-book").click();
    await expect(page.getByTestId("book-page")).toBeVisible({ timeout: 30_000 });
    const book = (await page.getByTestId("book-page").boundingBox())!;
    expect(book.width).toBeLessThanOrEqual(640);
    expect(await page.getByTestId("book-page").evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(20);

    // Finish, then Sent: the tick and the "What happens next" card.
    await page.goto(`/estimate/finish?id=${id}`);
    await expect(page.getByTestId("finish")).toBeVisible({ timeout: 30_000 });
    expect(await head(page)).toBeLessThanOrEqual(64);
    await noFullBleedBar(page);
    await page.getByTestId("finish-send_for_confirmation").click();
    await page.waitForURL(/\/estimate\/sent/, { timeout: 30_000 });
    await expect(page.getByTestId("sent")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("sent").locator(".wz-bigtick")).toBeVisible();
    await expect(page.getByTestId("sent").locator(".wz-next")).toContainText("What happens next");
  });

  test("home outside: the outside and sides steps, and the side-by-side editor", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await fillQuickAddress(page);
    await page.getByTestId("ql-jobtype-exterior").click();
    await quickNext(page);
    await quickNext(page);
    await newShellStep(page, "outside");
    await page.getByTestId("ql-ext-el-body").click();
    await page.getByTestId("ql-ext-mat-weatherboards").click();
    await quickNext(page);
    await newShellStep(page, "sides");
    await quickNext(page);
    await passGateIfShown(page);
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    await page.getByTestId("door-tighten").click();
    await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
    expect(await head(page)).toBeLessThanOrEqual(64);
    await twoColumns(page, ".sd-ed > .sc-wrap", ".sc-rail");
    await noFullBleedBar(page);
  });

  test("home both: the stacked editor", async ({ page }) => {
    test.setTimeout(300_000);
    await driveNoPlanWizard(page, { jobType: "both" });
    await openScopeEditor(page);
    expect(await head(page)).toBeLessThanOrEqual(64);
    await twoColumns(page, ".sc-ed > .sc-wrap", ".sc-rail");
    await expect(page.locator("#outside")).toBeAttached();
    await noFullBleedBar(page);
  });

  test("commercial: Space, Areas, Job, the warehouse; and a visit-only brief, Book and Booked", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await fillQuickAddress(page);
    await quickNext(page);
    await page.getByTestId("ql-kind-commercial").click();
    await quickNext(page);
    await newShellStep(page, "segment");
    await page.getByTestId("ql-segment-office").click();
    await quickNext(page);
    await newShellStep(page, "com_areas");
    await quickNext(page);
    await newShellStep(page, "com_job");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByTestId("ql-segment-warehouse").click();
    await quickNext(page);
    await newShellStep(page, "com_warehouse");

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByTestId("ql-segment-strata").click();
    await quickNext(page);
    await newShellStep(page, "com_brief");
    // Strata starts with its first "what" ticked; its meeting date is ours to give —
    // a calendar day in Melbourne, a month out (never toISOString: that is the UTC day).
    const date = page.locator("[data-quick-step='com_brief'] input[type='date']");
    if (await date.count()) {
      await date.fill(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date(Date.now() + 30 * 86_400_000)));
    }
    await quickNext(page);
    await newShellStep(page, "com_book");
    await page.getByTestId("book-email").fill(`ui.cover.brief.${Date.now()}@example.com`);
    await page.getByTestId("book-name").fill("Coverage Check");
    await page.getByTestId("book-phone").fill("0400 000 222");
    await quickNext(page);
    await expect(page.getByTestId("brief-done")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("brief-done").locator(".wz-bigtick")).toBeVisible();
    await expect(page.getByTestId("brief-done").locator(".wz-next")).toContainText("What happens next");
  });

  test("the guardrail outcome: one centred card, when the test stack's service area sends a far postcode to it", async ({ page }) => {
    test.setTimeout(300_000);
    await openQuickLook(page);
    await page.getByPlaceholder(/Your address/).fill("1 Martin Place, Sydney");
    await page.getByPlaceholder("Suburb").fill("Sydney");
    await page.getByPlaceholder("Postcode").fill("2000");
    await quickNext(page);
    await quickNext(page);
    await quickNext(page);
    await quickNext(page);
    await quickNext(page);
    await passGateIfShown(page, { email: `ui.cover.far.${Date.now()}@example.com` });
    const stop = page.getByTestId("hard-stop");
    await expect(stop.or(page.getByTestId("reveal"))).toBeVisible({ timeout: 90_000 });
    test.skip(!(await stop.count()), "the test stack has no service area configured, so a far postcode prices normally — the card is not reachable here");
    const box = (await stop.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.x + box.width / 2 - W / 2), "centred").toBeLessThan(20);
    await expect(page.getByTestId("hard-stop-what")).toBeVisible();
  });
});
