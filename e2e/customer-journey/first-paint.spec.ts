import { test, expect } from "@playwright/test";
import { openQuickLook, fillQuickAddress, quickNext } from "./drive";

/**
 * The wizard's first paint (Lighthouse mobile ≥ 90 on /estimate and
 * /estimate/scope, 11 Oct 2026). Three things held the largest paint back and
 * each can come back with one innocent line, so each is pinned here, as an
 * anonymous customer:
 *
 *  1. A stylesheet from another origin. globals.css opened with an @import of
 *     Google Fonts' CSS — every page's first paint waited on a second origin
 *     (~690ms simulated), for a face the wizard never uses. Martian Mono is
 *     self-hosted now (app/fonts/martian-mono/).
 *  2. supabase-js in the first-load scripts. Lighthouse charges every byte
 *     requested before the largest paint to it; the wizard's components load
 *     the client on first use (lib/supabase/lazyClient.ts).
 *  3. The step entrance on the landing screen. Its fade held the first
 *     screen's text back for half a second, which made the largest paint wait
 *     for every script. The landing screen paints still (.wz-landing); the
 *     NEXT step still rises in.
 *
 * Lighthouse S7 (20 Oct 2026) added two more, measured on the exterior v2
 * screens by reloading at each step (the resume restores it):
 *
 *  4. The screens after the questions — the range, the walk, the result, the
 *     talk sheet and the commercial screens — are not in the first-load
 *     scripts (next/dynamic in WizardApp and QuickLook, prefetched a moment
 *     after the customer is on a step that leads to them).
 *  5. A RESUMED step is a landing step too: a reload mid-walk paints the
 *     restored screen still, and the step after it rises in as before.
 */
test("the first screen paints without another origin's stylesheet, supabase-js, or the entrance", async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreignCss: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "stylesheet" && new URL(r.url()).origin !== origin) foreignCss.push(r.url());
  });

  await openQuickLook(page);
  expect(foreignCss).toEqual([]);

  // The scripts the HTML itself asks for — the first load, before anything lazy.
  const html = await (await request.get("/estimate")).text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"(?![^>]*noModule)/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) {
    const body = await (await request.get(src)).text();
    expect(body.includes("GoTrueClient"), `${src} carries supabase-js`).toBe(false);
    // 4: the late screens, by a string each of them alone carries.
    for (const [screen, marker] of [["the range (Reveal)", "reveal-range"], ["the walk (ExteriorWalk)", "ext-walk-steps"], ["the talk sheet", 'talk-sheet"'], ["the commercial screens", "wh-racking"]]) {
      expect(body.includes(marker), `${src} carries ${screen}`).toBe(false);
    }
  }

  // The landing screen: no entrance on its content.
  const landing = page.locator(".wz-step.wz-landing");
  await expect(landing).toBeVisible();
  const firstAnim = await landing.locator(".wz-stage > .wz-pane > .wz-sub").first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(firstAnim).toBe("none");

  // …and the next step rises in exactly as before.
  await fillQuickAddress(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".wz-step.wz-landing")).toHaveCount(0);
  const nextAnim = await page.locator("[data-quick-step='place'] > *").first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(nextAnim).toBe("wzrise");
});

test("a resumed step paints still, and the step after it rises in", async ({ page }) => {
  await openQuickLook(page);
  await fillQuickAddress(page);
  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  // The resume record is written 400ms after the step settles (WizardApp).
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator("[data-quick-step='place']")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("wz-resume")).toBeVisible();
  const landing = page.locator(".wz-step.wz-landing");
  await expect(landing).toBeVisible();
  const resumedAnim = await landing.locator("[data-quick-step='place'] > *").first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(resumedAnim).toBe("none");

  await quickNext(page);
  await expect(page.locator("[data-quick-step='place']")).toHaveCount(0);
  await expect(page.locator(".wz-step.wz-landing")).toHaveCount(0);
  const nextAnim = await page.locator(".wz-step .wz-stage > .wz-pane > *").first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(nextAnim).toBe("wzrise");
});
