import { expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { test } from "../helpers";
import { expectDarkHeader } from "./drive";

/**
 * Tom, 20 Nov 2026: "update our logo so it sits on a dark background like our website and looks a bit neater and
 * bigger — at the moment it's hard to read in the middle of the screen and needs to stand out more."
 *
 * The mark he means is the one in the middle of the phone header: 22px on the page's pale grey. As an ANONYMOUS
 * customer on a phone, on both brands, the first screen of the wizard wears a dark bar with the dark-background mark
 * at 30px or more, on the centre line, in a header no taller than the 56px the phone's shell is held to. The quote
 * stage wears the same bar at both widths — quote-stage-v10-s6.spec.ts runs the same check there. On a laptop the
 * question screens' header (the step rail's row) is the same dark bar with the same mark, top-left.
 *
 * WIZARD_HEADER_SHOTS=<folder> also saves a screenshot per brand. Nothing is written to the database: no answer is
 * given, so there is no draft to remove.
 */
const SHOTS = process.env.WIZARD_HEADER_SHOTS ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.describe("the wizard's phone header: the mark on a dark bar, bigger, centred", () => {
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  for (const brand of ["paintgroup", "painthome"] as const) {
    test(`${brand}: an anonymous customer's first screen`, async ({ page, baseURL }) => {
      const u = new URL(baseURL!);
      const root = brand === "painthome" ? `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}` : u.origin;
      await page.goto(`${root}/estimate`);
      await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
      await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 30_000 });
      await expectDarkHeader(page);
      const head = (await page.getByTestId("wzm-head").boundingBox())!;
      expect(head.height, "still a slim header").toBeLessThanOrEqual(56);
      expect(head.width, "the bar runs edge to edge").toBe(390);
      if (brand === "painthome") {
        await expect(page.locator(".wzm-head [data-testid='painthome-logo-nav']")).toBeVisible();
        await expect(page.getByTestId("wzm-head")).not.toContainText("Paint Group");
      }
      if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/wizard-390-${brand}.png`, animations: "disabled" }); }
    });
  }
});

test.describe("the wizard's laptop header: the same dark bar, the same mark", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const brand of ["paintgroup", "painthome"] as const) {
    test(`${brand}: an anonymous customer's first screen at 1280px`, async ({ page, baseURL }) => {
      const u = new URL(baseURL!);
      const root = brand === "painthome" ? `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}` : u.origin;
      await page.goto(`${root}/estimate`);
      await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
      const head = page.getByTestId("wz-head");
      await expect(head).toBeVisible({ timeout: 30_000 });
      const m = await head.evaluate((el) => {
        const lum = (css: string) => { const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
        const mark = el.querySelector(".wz-head-logo .wz-logo, .wz-head-logo .wz-wm") as HTMLElement | SVGElement | null;
        const cur = el.querySelector(".wz-rail li.cur");
        const save = el.querySelector("[data-testid='save-and-book-pill']");
        return {
          barLum: lum(getComputedStyle(el).backgroundColor), markH: mark?.getBoundingClientRect().height ?? 0,
          lettered: mark?.classList.contains("wz-wm") ?? false, fontPx: mark ? parseFloat(getComputedStyle(mark).fontSize) : 0,
          markLum: mark && mark.classList.contains("wz-wm") ? lum(getComputedStyle(mark).color) : 1,
          text: mark?.tagName.toLowerCase() === "svg" ? mark.querySelectorAll("path")[1]?.getAttribute("fill") ?? null : mark?.getAttribute("data-on") ?? null,
          curLum: cur ? lum(getComputedStyle(cur).color) : 0, saveLum: save ? lum(getComputedStyle(save).color) : 1,
        };
      });
      expect(m.barLum, "the laptop header is dark, like the website's nav").toBeLessThan(0.1);
      if (m.lettered) { expect(m.fontPx).toBeGreaterThanOrEqual(15); expect(m.markLum, "the lettered wordmark is light").toBeGreaterThan(0.8); }
      else expect(m.markH, "the mark is bigger than the 26px it was").toBeGreaterThanOrEqual(32);
      expect(["dark", "#eeeeee"], "the mark is the dark-background one").toContain(m.text);
      expect(m.curLum, "the step you are on reads light on the dark bar").toBeGreaterThan(0.8);
      expect(m.saveLum, "Save & book reads light on the dark bar").toBeGreaterThan(0.8);
      if (SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/wizard-1280-${brand}.png`, animations: "disabled" }); }
    });
  }
});
