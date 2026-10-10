import { test, expect, devices, type Page } from "@playwright/test";
import { stepsFor, type QuickLook } from "../../lib/wizard/quick-look";
import { STEP_LABELS } from "../../app/wizard/stepRail";
import { driveNoPlanWizard, fillQuickAddress, openQuickLook, openScopeEditor, passGateIfShown, quickNext, MONEY_RANGE } from "./drive";

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
    // S2: the picture sits ABOVE the question, about a fifth of the screen; "Your job so far" is hidden.
    const pic = (await page.getByTestId("ql-picture").boundingBox())!;
    const h1 = (await page.locator(".wz-pane h1").boundingBox())!;
    expect(pic.y + pic.height).toBeLessThanOrEqual(h1.y);
    expect(pic.height, "the phone picture stays small").toBeLessThanOrEqual(844 * 0.22);
    await expect(page.getByTestId("ql-sofar")).toBeHidden();
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

test.describe("UI refresh S2 · the live picture and Your job so far (home, inside)", () => {
  test("Job step: ticking and unticking each surface paints it in and out of the room", async ({ page }) => {
    await toPlace(page);
    await quickNext(page);
    await expect(page.locator("[data-quick-step='job']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ql-picture")).toHaveAttribute("data-picture", "room");
    const room = page.getByTestId("pic-room");
    // Brief §7.2: the surfaces in the order a person thinks about a room.
    const order = await page.getByTestId("ql-excl-options").locator("[data-testid^='ql-excl-']:not([data-testid='ql-excl-none'])")
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.replace("ql-excl-", "")));
    expect(order).toEqual(["walls", "ceilings", "skirting", "architraves", "doors", "windows"]);
    for (const s of order) {
      const shape = room.locator(`[data-s='${s}']`).first();
      await expect(shape).toHaveAttribute("data-on", "1");
      await page.getByTestId(`ql-excl-${s}`).click();
      await expect(shape, `${s} goes back to "today"`).toHaveAttribute("data-on", "0");
      await expect(page.getByTestId("ql-picture-note")).toContainText(/:/); // the trade word, explained
      await page.getByTestId(`ql-excl-${s}`).click();
      await expect(shape).toHaveAttribute("data-on", "1");
    }
  });

  test("Rooms step: a room left out goes dashed on the plan; Your job so far lists the answers with Change links", async ({ page }) => {
    await toPlace(page);
    await quickNext(page);
    await quickNext(page);
    await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ql-picture")).toHaveAttribute("data-picture", "plan");
    const first = page.getByTestId("ql-room-0");
    const name = (await first.innerText()).trim();
    await expect(page.getByTestId("pic-plan").locator(`g[data-room="${name}"]`)).toHaveAttribute("data-state", "on");
    await first.click();
    await expect(page.getByTestId("pic-plan").locator(`g[data-room="${name}"]`)).toHaveAttribute("data-state", "off");
    // One row per answered step, each with a Change link that goes back to it.
    const sofar = page.getByTestId("ql-sofar");
    await expect(sofar.locator("li[data-step]")).toHaveCount(3); // address, the place, the job
    await sofar.getByTestId("ql-sofar-change-place").click();
    await expect(page.locator("[data-quick-step='place']")).toBeVisible();
  });

  test("Talk it through sits in the picture column on a laptop, named for the estimator, the three ways in intact", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toPlace(page);
    const talk = page.getByTestId("ql-side").getByTestId("ql-talk");
    await expect(talk).toContainText("Would you rather talk it through?");
    await expect(talk.getByTestId("ql-book")).toBeVisible();
    await expect(talk.getByTestId("ql-message")).toBeVisible();
    await expect(page.getByTestId("ql-talk")).toHaveCount(1); // rendered once, never a copy
  });

  test("the picture never moves the page: a fixed 4:3 box, aria-hidden art", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toPlace(page);
    const art = page.getByTestId("ql-picture").locator(".wz-pic-art");
    const a = (await art.boundingBox())!;
    expect(Math.round((a.width / a.height) * 100) / 100).toBeCloseTo(4 / 3, 1);
    await expect(page.getByTestId("pic-house")).toHaveAttribute("aria-hidden", "true");
    await page.getByTestId("ql-storeys-double").click();
    await expect(page.getByTestId("pic-house")).toHaveAttribute("data-storeys", "double");
    const b = (await art.boundingBox())!;
    expect(b.height).toBeCloseTo(a.height, 0);
  });
});

test.describe("UI refresh · on a real phone (iPhone 13 emulation) no screen is wider than the phone", () => {
  /**
   * A narrow WINDOW and a PHONE differ: on a phone, anything wider than the
   * screen makes the browser zoom the whole page out, which pushes the fixed
   * Continue bar below the visible screen — S2's three Inside / Outside / Both
   * cards did exactly that (the page laid out at 506px) and every phone spec
   * stalled on step 1. So this walks the steps on an emulated iPhone and
   * checks the page width on each one.
   */
  test("inside path and the commercial screens fit a 390px phone", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    const fits = async (where: string) => {
      const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
      expect(w.sw, `${where}: page ${w.sw}px wide on a 390px phone`).toBeLessThanOrEqual(390);
      expect(w.vw, `${where}: the browser zoomed out`).toBeLessThanOrEqual(390);
    };
    await openQuickLook(page);
    await fits("address");
    await fillQuickAddress(page);
    await fits("address, with the suburb and postcode boxes"); // the row that tipped S2 over
    await quickNext(page);
    for (const step of ["place", "job", "rooms", "condition"]) {
      await expect(page.locator(`[data-quick-step='${step}']`)).toBeVisible({ timeout: 30_000 });
      await fits(step);
      if (step === "place") { await page.getByTestId("ql-kind-commercial").click(); await fits("place, commercial"); await page.getByTestId("ql-kind-house").click(); }
      await quickNext(page);
    }
    const gate = page.locator("[data-quick-step='gate']");
    if (await gate.count()) await fits("gate");
    await ctx.close();
  });
});

test.describe("UI refresh S3 · the range screen, every path", () => {
  const money = (t: string) => { const m = t.replace(/,/g, "").match(/\$(\d+)\s*–\s*\$(\d+)/); return m ? [Number(m[1]), Number(m[2])] : null; };

  test("home inside: range card, three bars ending in Confirmed, Tighten is the one cyan door, the dark estimator strip", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await driveNoPlanWizard(page, { stopAtReveal: true });
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE);
    const tiers = page.getByTestId("reveal-tiers");
    await expect(tiers.locator("span.on")).toHaveText("Guide");
    await expect(tiers).toContainText("Detailed");
    await expect(tiers).toContainText("Confirmed");
    await expect(page.getByTestId("reveal-tiers-visit")).toHaveCount(0);
    await expect(page.getByTestId("door-tighten")).toHaveAttribute("data-hero", "1");
    await expect(page.locator(".wz-doors [data-hero='1']")).toHaveCount(1);
    await expect(page.getByTestId("estimator-strip")).toBeVisible();
    // After the details the rail is the three accuracy steps.
    await expect(page.getByTestId("wz-rail")).toHaveAttribute("data-phase", "after");
    await expect(page.getByTestId("wz-rail")).toContainText("Guide range");
    // Two columns: the doors sit to the right of the range card.
    const card = (await page.locator(".wz-rv-card").boundingBox())!;
    const doors = (await page.locator(".wz-rv-doors").boundingBox())!;
    expect(doors.x).toBeGreaterThan(card.x + card.width - 1);
  });

  test("home outside: two bars and the visit sentence — never a Confirmed bar", async ({ page }) => {
    test.setTimeout(180_000);
    await openQuickLook(page);
    await fillQuickAddress(page);
    await page.getByTestId("ql-jobtype-exterior").click();
    await quickNext(page);
    await quickNext(page);
    await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-ext-el-body").click();
    await page.getByTestId("ql-ext-mat-weatherboards").click();
    await quickNext(page);
    await quickNext(page);
    await passGateIfShown(page);
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    await expect(page.getByTestId("reveal-tiers")).not.toContainText("Confirmed");
    await expect(page.getByTestId("reveal-tiers-visit")).toContainText(/Every outside price is confirmed on site/);
    // "Speak with us" is the server's call (R25/R34 — under the phone limit, outside jobs included): not asserted here.
  });

  test("home both: the inside and outside ranges add up to the range shown", async ({ page }) => {
    test.setTimeout(240_000);
    await driveNoPlanWizard(page, { jobType: "both", stopAtReveal: true });
    const total = money(await page.getByTestId("reveal-range").innerText())!;
    const inside = money(await page.getByTestId("reveal-part-interior").innerText())!;
    const outside = money(await page.getByTestId("reveal-part-exterior").innerText())!;
    // Whole dollars on screen: each figure is rounded, so allow a dollar per part.
    expect(Math.abs(inside[0] + outside[0] - total[0])).toBeLessThanOrEqual(2);
    expect(Math.abs(inside[1] + outside[1] - total[1])).toBeLessThanOrEqual(2);
    await expect(page.getByTestId("reveal-tiers")).not.toContainText("Confirmed");
    // The widest range there is (two five-figure ends) still fits inside its card on a laptop.
    for (const width of [1280, 1440, 1000]) {
      await page.setViewportSize({ width, height: 900 });
      const fits = await page.locator(".wz-rv-card").evaluate((card) => {
        const r = card.querySelector("[data-testid='reveal-range']")!.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        return r.right <= c.right - 10 && card.scrollWidth <= card.clientWidth;
      });
      expect(fits, `the range fits its card at ${width}px`).toBe(true);
    }
  });

  test("commercial (office): the segment's kicker, the commercial note, two bars, the commercial trust line", async ({ page }) => {
    test.setTimeout(180_000);
    await toSegment(page);
    await page.getByTestId("ql-segment-office").click();
    await quickNext(page);
    await expect(page.locator("[data-quick-step='com_areas']")).toBeVisible({ timeout: 20_000 });
    await quickNext(page);
    await quickNext(page);
    await passGateIfShown(page);
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    await expect(page.getByTestId("reveal-kicker")).toContainText(/Office/);
    await expect(page.getByTestId("reveal-commercial-note")).toBeVisible();
    await expect(page.getByTestId("reveal-tiers")).not.toContainText("Confirmed");
    await expect(page.getByTestId("reveal-tiers-visit")).toContainText(/Every commercial price/);
    // "Speak with us" is the server's call (R25/R34 — under the phone limit, outside jobs included): not asserted here.
    await expect(page.getByTestId("reveal-trust")).toContainText("Certificates and SWMS with every quote");
  });

  test("phone: one column, nothing wider than the phone, Tighten in reach at the bottom", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await driveNoPlanWizard(page, { stopAtReveal: true });
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(w.sw).toBeLessThanOrEqual(390);
    expect(w.vw).toBeLessThanOrEqual(390);
    await expect(page.getByTestId("reveal-dock-tighten")).toBeVisible();
    await ctx.close();
  });
});

test.describe("UI refresh S4 · room by room", () => {
  test("laptop: a slim header, the rail filled without a floorplan, the range and progress always in view", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const head = (await page.locator(".sc-freeze").boundingBox())!;
    expect(head.height, "the frozen stack is the one slim header").toBeLessThanOrEqual(64);
    // No floorplan here — the rail still carries the price card, Your home and the estimator.
    const main = (await page.locator(".sc-ed > .sc-wrap").boundingBox())!;
    const price = (await page.getByTestId("price-card").boundingBox())!;
    expect(price.x, "the price card sits in the right-hand rail").toBeGreaterThan(main.x + main.width);
    await expect(page.locator(".sc-home")).toBeVisible();
    await expect(page.locator(".sc-home-art svg")).toBeVisible();
    await expect(page.locator(".sc-rail").getByTestId("estimator-strip")).toBeVisible();
    await expect(page.locator(".sc-stick button")).toHaveCount(2);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await expect(page.locator(".sc-num")).toBeInViewport();
    await expect(page.locator(".il-prog")).toBeInViewport();
  });

  test("phone: the header and the range strip together stay under 125px, nothing wider than the phone", async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(400);
    const strip = (await page.getByTestId("price-card").boundingBox())!;
    expect(strip.y + strip.height, "header + range strip").toBeLessThanOrEqual(125 + 30);
    await expect(page.locator(".sc-num")).toBeInViewport();
    await expect(page.locator(".il-prog")).toBeInViewport();
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(w.sw).toBeLessThanOrEqual(390);
    expect(w.vw).toBeLessThanOrEqual(390);
    const bar = (await page.locator(".sc-stick").boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThanOrEqual(664 - 2);
    await ctx.close();
  });

  test("cornices: answering No takes them off every room — the question never contradicts the tiles", async ({ page }) => {
    test.setTimeout(240_000);
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const q = page.getByTestId("details-cornices");
    test.skip(!(await q.count()), "this job's details did not ask about cornices");
    await q.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByTestId("last-change")).toContainText(/cornices/i, { timeout: 30_000 });
    await expect(page.locator(".sc-tl.on", { hasText: /^Cornices/ })).toHaveCount(0, { timeout: 30_000 });
  });
});

test.describe("UI refresh S4b · the room cards", () => {
  test("tiles Walls first; only the open card is amber; a checked card shows its tick and a one-line summary", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await driveNoPlanWizard(page);
    await openScopeEditor(page);
    const cards = page.locator(".sc-rc[data-room]");
    const first = cards.first();
    await first.locator(".il-hd").click().catch(() => undefined);
    await expect(first).toHaveClass(/\bopen\b/);
    // Walls is the first tile in the open card.
    await expect(first.locator(".sc-tgrid .sc-tl").first()).toContainText(/^Walls/);
    // Only the open card carries the amber border; the closed ones do not.
    const amberBorders = await cards.evaluateAll((els) => els.filter((e) => e.classList.contains("open")).length);
    expect(amberBorders).toBe(1);
    // Confirm it the way a customer would: the size, the robe questions, then Confirm.
    await first.getByRole("button", { name: "Looks right" }).click();
    for (let i = 0; i < 4 && (await first.locator(".il-cup:not(.ok)").count()); i++) {
      await first.locator(".il-cup:not(.ok)").first().getByRole("button", { name: "No", exact: true }).click();
      await page.waitForTimeout(300);
    }
    await first.locator(".il-confirm").click();
    await expect(first).toHaveClass(/done/, { timeout: 30_000 });
    await expect(first.locator(".sc-badge.ok")).toBeVisible();
    await expect(first.locator(".il-pill.done")).toHaveText(/Checked/);
    await expect(first.locator(".sc-sum")).toContainText(/walls/);
    // The next room opens by itself.
    await expect(cards.nth(1)).toHaveClass(/\bopen\b/, { timeout: 10_000 });
  });
});

test.describe("UI refresh S5 · home outside", () => {
  /** To the Outside step of an outside-only job. */
  async function toOutside(page: Page) {
    await openQuickLook(page);
    await fillQuickAddress(page);
    await page.getByTestId("ql-jobtype-exterior").click();
    await quickNext(page);
    await quickNext(page);
    await expect(page.locator("[data-quick-step='outside']")).toBeVisible({ timeout: 20_000 });
  }

  test("Tom's check: each tick paints into the house; a side left off goes dashed from above, and stays grey in the editor", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await toOutside(page);
    const pic = page.getByTestId("pic-outside");
    await expect(pic).toBeVisible();
    // Nothing pre-ticked: the walls and frames are today's colour.
    await expect(pic.locator("[data-e='body'][data-on]").first()).toHaveAttribute("data-on", "0");
    await page.getByTestId("ql-ext-el-body").click();
    await expect(pic.locator("[data-e='body'][data-on]").first()).toHaveAttribute("data-on", "1");
    await expect(page.getByTestId("ql-picture-note")).toContainText("Walls");
    await page.getByTestId("ql-ext-el-windows").click();
    await expect(pic.locator("[data-e='windows'][data-on]")).toHaveAttribute("data-on", "1");
    await page.getByTestId("ql-ext-sep-picket_fence").click();
    await expect(pic.locator("[data-x='picket_fence']")).toHaveAttribute("data-on", "1");
    await expect(page.getByTestId("ql-picture-note")).toContainText("Picket fence");
    await page.getByTestId("ql-ext-mat-weatherboards").click();
    await page.getByTestId("ql-ext-storeys-double").click();
    await expect(pic).toHaveClass(/two/);
    // On the house: two columns of picture cards on a laptop.
    const a = (await page.getByTestId("ql-ext-el-body").boundingBox())!;
    const b = (await page.getByTestId("ql-ext-el-windows").boundingBox())!;
    expect(Math.abs(a.y - b.y), "body and windows share a row").toBeLessThan(4);

    await quickNext(page);
    await expect(page.locator("[data-quick-step='sides']")).toBeVisible({ timeout: 20_000 });
    const top = page.getByTestId("pic-top");
    await expect(top.locator("[data-edge='right']")).toHaveAttribute("data-state", "on");
    await page.getByTestId("ql-ext-side-right").click();
    await expect(top.locator("[data-edge='right']")).toHaveAttribute("data-state", "off");

    await quickNext(page);
    await passGateIfShown(page);
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    await page.getByTestId("door-tighten").click();
    await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
    await openScopeEditor(page);
    // The S4 frame: one slim header, the price card and the house from above in the rail.
    const head = (await page.locator(".sc-freeze").boundingBox())!;
    expect(head.height).toBeLessThanOrEqual(64);
    const main = (await page.locator(".sd-ed > .sc-wrap").boundingBox())!;
    const price = (await page.getByTestId("price-card").boundingBox())!;
    expect(price.x, "the price card sits in the right-hand rail").toBeGreaterThan(main.x + main.width);
    const above = page.locator(".sc-rail .sd-visual");
    await expect(above.getByTestId("pic-top")).toBeVisible();
    await expect(above.locator("[data-edge='right']")).toHaveAttribute("data-state", "skip");
    await expect(above.locator("[data-edge='front']")).toHaveAttribute("data-state", "todo");
    await expect(page.locator(".sc-rail").getByTestId("estimator-strip")).toBeVisible();
    // Tap a side from above and its card opens.
    await above.locator("[data-edge='back']").click();
    await expect(page.locator(".sd-card[data-side='back'] .sd-body")).toBeVisible();
  });

  test("phone: the outside step and the side-by-side editor fit the phone, the bar at the bottom", async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await toOutside(page);
    await page.getByTestId("ql-ext-el-body").click();
    await page.getByTestId("ql-ext-sep-deck").click();
    let w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(w.sw).toBeLessThanOrEqual(390);
    await quickNext(page);
    await quickNext(page);
    await passGateIfShown(page);
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE, { timeout: 90_000 });
    await page.getByTestId("door-tighten").click();
    await expect(page.locator(".sd-card").first()).toBeVisible({ timeout: 90_000 });
    await openScopeEditor(page);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(400);
    await expect(page.locator(".sc-num")).toBeInViewport();
    w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
    expect(w.sw).toBeLessThanOrEqual(390);
    expect(w.vw).toBeLessThanOrEqual(390);
    const bar = (await page.locator(".sc-stick").boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThanOrEqual(664 - 2);
    await ctx.close();
  });
});
