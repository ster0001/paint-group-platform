import { test, expect, type Page } from "@playwright/test";
import { fillQuickAddress, MONEY_RANGE, openQuickLook, quickNext } from "./drive";
import { serviceClient } from "../fixtures/woLoop";

/**
 * C12 — segments as data, the office pattern, the commercial reveal.
 *
 * Tom's check: Office → 4 offices, 1 open plan, 1 meeting room → a range in
 * two screens; no Fix online anywhere. Accept: every segment string on screen
 * comes from the table · no commercial estimate can reach fix-online · the
 * open-space photo changes the band by exactly the Settings value.
 *
 * Replaces `commercial-kind.spec.ts` (phase 7a's seven gates, retired by C12).
 */

async function toSegment(page: Page) {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 30_000 });
}

test("the eight tiles come from the table, tagged by their route; a brief tile says so before Continue", async ({ page }) => {
  test.setTimeout(120_000);
  const db = serviceClient();
  await toSegment(page);
  const tiles = page.locator("[data-testid^='ql-segment-']");
  await expect(tiles).toHaveCount(8);
  // Every tile on screen is a row in commercial_segments, in the row's words.
  if (db) {
    const { data } = await db.from("commercial_segments").select("key, name, route, tile").eq("tile", true).order("position");
    if (data && data.length) {
      expect(await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("ql-segment-", "")))).toEqual(data.map((r) => r.key));
      for (const r of data as { key: string; name: string; route: string }[]) {
        const tile = page.getByTestId(`ql-segment-${r.key}`);
        await expect(tile).toContainText(r.name);
        await expect(tile).toHaveAttribute("data-route", r.route);
        await expect(tile.locator(".wz-segtag")).toHaveText(r.route === "range" ? "ONLINE · OR WE VISIT" : "WE VISIT");
      }
    }
  }
  // v2.2: the which-part row, and the brief door says so on the screen.
  await expect(page.getByTestId("ql-cpart-interior")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("ql-segment-strata").click();
  await expect(page.getByTestId("segment-visit-note")).toContainText(/priced on site/i);
  await page.getByTestId("ql-next").click();
  await expect(page.getByText(/deserves a person/i)).toBeVisible({ timeout: 30_000 });
  // §4.16: no number anywhere on the brief door.
  await expect(page.locator("body")).not.toContainText(MONEY_RANGE);
});

test("Tom's check: office → 4 offices, 1 open plan, 1 meeting room → a range in two screens; no Fix online anywhere", async ({ page }) => {
  test.setTimeout(300_000);
  await toSegment(page);
  await page.getByTestId("ql-segment-office").click();
  await quickNext(page);

  // Screen 1 of 2 — the areas, rendered from the row: the counts default to
  // the seed (4 / 1 / 1) and the open-space card is there because open > 0.
  await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-count-offices-n")).toHaveText("4");
  await expect(page.getByTestId("com-count-open-n")).toHaveText("1");
  await expect(page.getByTestId("com-count-meeting-n")).toHaveText("1");
  await expect(page.getByTestId("com-open")).toBeVisible();
  await expect(page.getByTestId("com-ceil-tiles")).toHaveAttribute("aria-pressed", "true");
  // No height question on the office pattern (size mode), and nothing about partitions or frontage.
  await expect(page.getByTestId("com-height")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/how much is gl/i);
  // The steppers work, and go back.
  await page.getByTestId("com-count-offices-plus").click();
  await expect(page.getByTestId("com-count-offices-n")).toHaveText("5");
  await page.getByTestId("com-count-offices-minus").click();
  await expect(page.getByTestId("com-count-offices-n")).toHaveText("4");
  await quickNext(page);

  // Screen 2 of 2 — the job: the row's surfaces, C9's colour tiles, the
  // condition bands with the segment's own wear/work words, hours, occupied.
  await expect(page.locator("[data-quick-step='com_job']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-surf-walls")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("ql-changing-walls")).toBeVisible();
  await expect(page.getByTestId("ql-condition-wear")).toContainText("picture hooks");
  await expect(page.getByTestId("com-hours-business")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("com-occ-vacant")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("com-hours-after").click();
  await expect(page.getByTestId("ql-next")).toHaveText(/See my guide range/);
  await quickNext(page);

  // The reveal — the commercial variant.
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-kicker")).toContainText(/Office/);
  await expect(page.getByTestId("reveal-commercial-note")).toContainText(/estimators confirms it/i);
  // ⚑20: widened by the Settings value (5) plus the no-photo value (3) — read
  // from the note's attribute, which the server wrote.
  await expect(page.getByTestId("reveal-commercial-note")).toHaveAttribute("data-widen", "8");
  await expect(page.getByTestId("reveal-restatement")).toContainText(/an office with 4 offices, 1 open plan and 1 meeting room/);
  await expect(page.getByTestId("reveal-restatement")).toContainText(/after hours/i);
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed-open")).toContainText(/tiled ceilings \(not painted\)/);
  await expect(page.getByTestId("reveal-assumed-hours")).toContainText(/After hours/);
  // A person confirms — never fix-online.
  await expect(page.getByTestId("reveal-flag")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Fix (my )?price online|Fix online/i);

  // The tighten screen: six areas from the seed, and still no Fix online.
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  await expect(page.getByTestId("estimator-strip").first()).toBeVisible({ timeout: 60_000 });
  const names = await page.locator("body").innerText();
  for (const n of ["Office 1", "Office 4", "Open plan", "Meeting room"]) expect(names).toContain(n);
  // §4.15: the finalise control never offers self-acceptance on a commercial job.
  await expect(page.locator("body")).not.toContainText(/Fix (my )?price online|Fix online|Accept estimate/i);
  await expect(page.getByTestId("scope-finalise")).not.toHaveText(/Accept estimate/);
});

test("health: aged care prices online; a hospital leaves for the brief from the areas screen", async ({ page }) => {
  test.setTimeout(200_000);
  await toSegment(page);
  await page.getByTestId("ql-segment-health").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-kind-aged")).toHaveAttribute("aria-pressed", "true");
  // The health row's counts and its own open label.
  await expect(page.getByTestId("com-count-rooms-n")).toHaveText("12");
  await expect(page.getByTestId("com-open")).toContainText(/Lounge or dining room/);
  await page.getByTestId("com-kind-hospital").click();
  await quickNext(page);
  await expect(page.getByText(/deserves a person/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("outcome-why")).toContainText(/hospital/i);
  await expect(page.locator("body")).not.toContainText(MONEY_RANGE);
});

test("school: the hall asks its height, and over 6 m allows for a platform", async ({ page }) => {
  test.setTimeout(200_000);
  await toSegment(page);
  await page.getByTestId("ql-segment-school").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-height-6")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("com-height-9").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='com_job']")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("com-hours-holidays")).toHaveAttribute("aria-pressed", "true");
  await quickNext(page);
  await expect(page.getByTestId("reveal-range")).toContainText(MONEY_RANGE, { timeout: 90_000 });
  await expect(page.getByTestId("reveal-kicker")).toContainText(/School/);
  await page.getByTestId("reveal-assumed-toggle").click();
  await expect(page.getByTestId("reveal-assumed-open")).toContainText(/over 6 m — platform or lift allowed for/);
  // The EWP line is on the tighten screen's "still to settle" list — flagged
  // and unpriced, exactly one.
  await page.getByTestId("door-tighten").click();
  await page.waitForURL(/\/estimate\/scope/, { timeout: 60_000 });
  const settle = page.locator(".wz-confirmonsite");
  await expect(settle).toContainText(/Platform or lift for walls over 4 m/, { timeout: 60_000 });
  expect(((await settle.innerText()).match(/Platform or lift/g) ?? []).length).toBe(1);
});
