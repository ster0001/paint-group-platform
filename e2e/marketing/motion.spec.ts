import { test, expect, type Page } from "@playwright/test";

/**
 * Homepage v2 · session 6 — motion, as an ANONYMOUS visitor (brief §4.2,
 * §4.7, §4.8 ACs). Timings are asserted by the unit tests on the pure
 * timelines; this proves the screen: the ghost types and answers, stops
 * for good on touch, idles under reduced motion; the story plays once,
 * completes, replays, and shows its end state under reduced motion; the
 * tiles count up to the config numbers.
 */
async function captureEvents(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __pgEvents?: unknown[] };
    w.__pgEvents = [];
    window.addEventListener("pg:track", (e) => { w.__pgEvents!.push((e as CustomEvent).detail); });
  });
}
type Captured = { name: string; props: Record<string, unknown> };
const events = (page: Page) => page.evaluate(() => (window as Window & { __pgEvents?: Captured[] }).__pgEvents ?? []);

test.describe("ghost estimator (§4.2)", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("cold load: mid-typing within 2 s, a result within 6 s, the chip follows, then loops", async ({ page }) => {
    await captureEvents(page);
    await page.goto("/");
    const hero = page.locator("#top");
    const field = hero.getByRole("textbox", { name: "Address" });
    await expect(field).not.toHaveValue("", { timeout: 2_000 });
    await expect(hero.locator("form.field")).toHaveClass(/typing/);
    await expect(field).toHaveAttribute("placeholder", "");
    await expect(hero.getByTestId("ghost-result")).toHaveClass(/\bon\b/, { timeout: 6_000 });
    await expect(hero.getByTestId("ghost-result")).toContainText("$8,400 – $9,600");
    await expect(field).toHaveValue("12 Elm Street, Northcote");
    await expect(hero.getByRole("button", { name: "My home" })).toHaveAttribute("aria-pressed", "true");
    // the second example is a business — the chip follows
    await expect(hero.getByRole("button", { name: "A business or property I manage" })).toHaveAttribute("aria-pressed", "true", { timeout: 12_000 });
    expect((await events(page)).map((e) => e.name)).not.toContain("ghost_stopped");
  });

  test("tapping the field at any point leaves it empty, focused, with no ghost text — and it never restarts", async ({ page }) => {
    await captureEvents(page);
    await page.goto("/");
    const hero = page.locator("#top");
    const field = hero.getByRole("textbox", { name: "Address" });
    await expect(field).not.toHaveValue("", { timeout: 2_000 });
    await field.tap();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    await expect(field).toHaveAttribute("placeholder", "Type your address");
    await expect(hero.getByTestId("ghost-result")).not.toHaveClass(/\bon\b/);
    await expect(hero.getByTestId("ghost-result")).toHaveText("");
    await expect(hero.getByRole("button", { name: "My home" })).toHaveAttribute("aria-pressed", "true");
    const seen = (await events(page)).filter((e) => e.name === "ghost_stopped");
    expect(seen).toHaveLength(1);
    expect(seen[0].props).toEqual({ where: "hero" });
    await page.waitForTimeout(5_000);
    await expect(field).toHaveValue("");
    await expect(hero.locator("form.field")).not.toHaveClass(/typing/);
    expect((await events(page)).filter((e) => e.name === "ghost_stopped")).toHaveLength(1);
  });

  test("tapping a chip stops it too, and the chip choice sticks", async ({ page }) => {
    await captureEvents(page);
    await page.goto("/");
    const hero = page.locator("#top");
    await expect(hero.getByRole("textbox", { name: "Address" })).not.toHaveValue("", { timeout: 2_000 });
    await hero.getByRole("button", { name: "A business or property I manage" }).tap();
    await expect(hero.getByRole("textbox", { name: "Address" })).toHaveValue("");
    await expect(hero.getByRole("button", { name: "A business or property I manage" })).toHaveAttribute("aria-pressed", "true");
    const names = (await events(page)).map((e) => e.name);
    expect(names).toContain("ghost_stopped");
    expect(names).toContain("mode_business");
  });

  test("reduced motion: the field is empty and idle, chips default to My home", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const hero = page.locator("#top");
    await page.waitForTimeout(3_000);
    await expect(hero.getByRole("textbox", { name: "Address" })).toHaveValue("");
    await expect(hero.locator("form.field")).not.toHaveClass(/typing/);
    await expect(hero.getByRole("button", { name: "My home" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("progress story (§4.7) + count-up (§4.8)", () => {
  test("plays once on entering view, completes in ~22 s, never auto-replays, Replay restarts from 0", async ({ page }) => {
    test.setTimeout(120_000);
    await captureEvents(page);
    await page.goto("/");
    const story = page.getByTestId("story");
    await expect(story).toHaveAttribute("data-story-state", "idle");
    await story.scrollIntoViewIfNeeded();
    await expect(story).toHaveAttribute("data-story-state", "playing", { timeout: 5_000 });
    const t0 = Date.now();
    await expect(page.getByTestId("story-caption")).toContainText("Monday, 7:31am");
    await expect(page.getByTestId("story-day")).toHaveText("Day 1 of 5");
    await expect(page.getByTestId("story-day")).toHaveText("Day 3 of 5", { timeout: 12_000 });
    await expect(page.getByTestId("story-caption")).toContainText("You sign off. Then you pay.", { timeout: 20_000 });
    await expect(story).toHaveAttribute("data-story-state", "done", { timeout: 10_000 });
    const runtime = Date.now() - t0;
    expect(runtime).toBeGreaterThan(20_000);
    expect(runtime).toBeLessThan(26_000); // 22 s ± the assertion polling
    await expect(page.getByTestId("story-day")).toHaveText("Day 5 of 5");
    await expect(page.getByTestId("story-phone").locator('.parea[data-s="done"]')).toHaveCount(5);
    await expect(page.getByTestId("story-replay")).toBeVisible();

    // scroll away and back — no second play
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await story.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_500);
    await expect(story).toHaveAttribute("data-story-state", "done");

    await page.getByTestId("story-replay").click();
    await expect(story).toHaveAttribute("data-story-state", "playing");
    await expect(page.getByTestId("story-day")).toHaveText("Day 1 of 5");
    await expect(page.getByTestId("story-caption")).toContainText("Monday, 7:31am");

    const names = (await events(page)).map((e) => e.name);
    expect(names.filter((n) => n === "progress_story_start")).toHaveLength(1);
    expect(names.filter((n) => n === "progress_story_complete")).toHaveLength(1);
    expect(names.filter((n) => n === "progress_story_replay")).toHaveLength(1);
  });

  test("reduced motion: the final frame with the eight captions listed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#story");
    const story = page.getByTestId("story");
    await expect(story).toHaveAttribute("data-story-state", "reduced");
    await expect(page.getByTestId("story-day")).toHaveText("Day 5 of 5");
    await expect(page.getByTestId("story-phone").locator('.parea[data-s="done"]')).toHaveCount(5);
    await expect(page.getByTestId("story-captions")).toBeVisible();
    await expect(page.getByTestId("story-captions").getByRole("listitem")).toHaveCount(8);
    await expect(page.getByTestId("story-caption")).toHaveCount(0);
  });

  test("the live tiles count up to the config numbers", async ({ page }) => {
    await page.goto("/");
    const live = page.locator("#live");
    await live.scrollIntoViewIfNeeded();
    await expect(live.locator(".big").nth(0)).toHaveText("38", { timeout: 5_000 });
    await expect(live.locator(".big").nth(2)).toHaveText("100%");
    await expect(live.locator(".big").nth(3)).toHaveText("9 min");
  });
});
