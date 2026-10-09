import { test, expect, type Page } from "@playwright/test";
import { stepsFor, type QuickLook } from "../../lib/wizard/quick-look";
import { STEP_LABELS } from "../../app/wizard/stepRail";
import { fillQuickAddress, openQuickLook, quickNext } from "./drive";

/**
 * Wizard UI refresh, S1 — the shell, on every path (brief §7.1, §7.7, §10).
 *
 * As an anonymous customer: the step rail in the header shows exactly the
 * steps `stepsFor()` returns for the answers given — same steps, same order,
 * same names, ending in "Your range" or (visit only) "Booked" — for home
 * inside, outside and both, a ranged commercial segment, the warehouse, a
 * visit-only segment, the hospital and a commercial outside answer. Then the
 * layout contract: a slim header, two columns on a laptop with the content
 * column 560–640px wide and no full-bleed button, one column on a phone with
 * no sideways scroll and a fixed bottom bar.
 *
 * Whether the details question comes last ("details first") is a switch in
 * Booking rules; the expected list takes the gate exactly when the rail shows
 * it, so the order is checked under either setting.
 */

async function railKeys(page: Page): Promise<string[]> {
  const items = page.getByTestId("wz-rail").locator("li[data-step]");
  return items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.step ?? ""));
}

async function expectRail(page: Page, expected: (gate: boolean) => string[], end: "Your range" | "Booked") {
  const keys = await railKeys(page);
  const want = expected(keys.includes("gate")).filter((s) => s !== "both");
  expect(keys, "the rail is stepsFor(), in order").toEqual(want);
  const labels = await page.getByTestId("wz-rail").locator("li[data-step] .l").allTextContents();
  expect(labels).toEqual(want.map((k) => STEP_LABELS[k as keyof typeof STEP_LABELS].rail));
  await expect(page.getByTestId("wz-rail-end")).toHaveText(end);
}

const home = (jobType: QuickLook["jobType"]) => (gate: boolean) => stepsFor(jobType, "house", "areas", "range", "whole", gate);

async function toPlace(page: Page, jobType?: "exterior" | "both") {
  await openQuickLook(page);
  await fillQuickAddress(page);
  if (jobType) await page.getByTestId(`ql-jobtype-${jobType}`).click();
  await quickNext(page);
  if (jobType === "both") {
    await expect(page.locator("[data-quick-step='both']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-both-self").click();
  }
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
}

async function toSegment(page: Page) {
  await toPlace(page);
  await page.getByTestId("ql-kind-commercial").click();
  await quickNext(page);
  await expect(page.locator("[data-quick-step='segment']")).toBeVisible({ timeout: 20_000 });
}

test.describe("UI refresh S1 · the step rail is stepsFor() on every path", () => {
  test("home, inside", async ({ page }) => {
    await toPlace(page);
    await expectRail(page, home("interior"), "Your range");
    // The current step is the second; the first is ticked.
    await expect(page.getByTestId("wz-rail").locator("li[data-step='start']")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("wz-rail").locator("li[data-step='place']")).toHaveAttribute("data-state", "cur");
  });

  test("home, outside", async ({ page }) => {
    await toPlace(page, "exterior");
    await expectRail(page, home("exterior"), "Your range");
  });

  test("home, both — eight counted steps, the choice screen not one of them, the rail compact", async ({ page }) => {
    await toPlace(page, "both");
    await expectRail(page, home("both"), "Your range");
    await expect(page.locator(".wz-rail")).toHaveClass(/compact/);
  });

  test("commercial, ranged (office) and the warehouse", async ({ page }) => {
    await toSegment(page);
    await page.getByTestId("ql-segment-office").click();
    await expectRail(page, (g) => stepsFor("interior", "commercial", "areas", "range", "whole", g), "Your range");
    await page.getByTestId("ql-segment-warehouse").click();
    await expectRail(page, (g) => stepsFor("interior", "commercial", "warehouse", "range", "whole", g), "Your range");
  });

  test("commercial, visit only (strata) ends in Booked; a commercial outside answer too", async ({ page }) => {
    await toSegment(page);
    await page.getByTestId("ql-segment-strata").click();
    await expectRail(page, () => stepsFor("interior", "commercial", "areas", "brief", "whole", true), "Booked");
    await page.getByTestId("ql-segment-office").click();
    await page.getByTestId("ql-cpart-exterior").click();
    await expectRail(page, () => stepsFor("exterior", "commercial", "areas", "brief", "whole", true), "Booked");
  });

  test("commercial, hospital — the areas screen, then the questions and the booking", async ({ page }) => {
    await toSegment(page);
    await page.getByTestId("ql-segment-health").click();
    await quickNext(page);
    await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("com-kind-hospital").click();
    await expectRail(page, () => stepsFor("interior", "commercial", "areas", "brief_after_areas", "whole", true), "Booked");
  });
});

test.describe("UI refresh S1 · the shell's layout contract", () => {
  for (const width of [1280, 1440]) {
    test(`at ${width}px: a 64px header, two columns, the content column 560–640px, no full-bleed button`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await toPlace(page);
      const head = (await page.getByTestId("wz-head").boundingBox())!;
      expect(head.height).toBeLessThanOrEqual(64);
      const pane = (await page.locator(".wz-pane").boundingBox())!;
      expect(pane.width).toBeGreaterThanOrEqual(560);
      expect(pane.width).toBeLessThanOrEqual(640);
      const side = (await page.getByTestId("ql-side").boundingBox())!;
      expect(side.x, "the picture column sits to the right of the questions").toBeGreaterThan(pane.x + pane.width);
      const next = (await page.getByTestId("ql-next").boundingBox())!;
      expect(next.width, "Continue is a pill inside the column").toBeLessThan(pane.width);
      await expect(page.locator(".wz-nav--col")).toHaveCSS("position", "static");
      // No dots, no floating "Step x of y", no dashed talk box on the customer's path.
      await expect(page.locator(".wz-dots")).toHaveCount(0);
      await expect(page.locator(".wz-steps")).toHaveCount(0);
      await expect(page.locator(".wz-rather")).toHaveCount(0);
      // The ways to a person stay one tap away (addendum A, R3).
      await expect(page.getByTestId("ql-book")).toBeVisible();
      await expect(page.getByTestId("ql-message")).toBeVisible();
      // ⚑ 10: the chat is an icon in the header.
      await expect(page.getByTestId("wz-head").getByTestId("wz-chat-bubble")).toBeVisible();
    });
  }

  test("at 390px: one column, the progress row, no sideways scroll, Continue in a fixed bottom bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await toPlace(page);
    await expect(page.getByTestId("wz-mprog")).toContainText(/Step 2 of \d+ · The place/);
    await expect(page.locator(".wz-rail")).toBeHidden();
    await expect(page.getByTestId("ql-side")).toBeHidden();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw, "no horizontal scroll").toBeLessThanOrEqual(390);
    const head = (await page.getByTestId("wz-head").boundingBox())!;
    expect(head.height, "56px header plus the progress row").toBeLessThanOrEqual(56 + 50);
    await page.mouse.wheel(0, 600);
    const nav = (await page.locator(".wz-nav--col").boundingBox())!;
    expect(nav.y + nav.height, "the bar sits on the bottom edge").toBeGreaterThanOrEqual(844 - 1);
    expect(nav.y + nav.height).toBeLessThanOrEqual(844 + 1);
  });

  test("Continue is never silently unavailable: a missing answer is named, in one line", async ({ page }) => {
    await toPlace(page);
    await quickNext(page); // the job
    await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 20_000 });
    await quickNext(page); // the rooms
    await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
    // Untick every room, then press Continue: it stays, and says why.
    const rooms = page.getByTestId("ql-rooms").locator("[aria-pressed='true']");
    while (await rooms.count()) await rooms.first().click();
    await page.getByTestId("ql-next").click();
    await expect(page.locator("[data-quick-step='rooms']")).toBeVisible();
    await expect(page.getByTestId("ql-error").or(page.getByTestId("ql-rooms-none")).first()).toContainText(/room/i);
  });
});
