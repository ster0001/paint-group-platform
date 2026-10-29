import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE, answerOutsideQuick, driveMobileQuickLook } from "./drive";

/**
 * Wizard mobile v5 — session 7 (plan §2 "Full E2E on both brands at 390px",
 * brief §7 the phone hero), as an ANONYMOUS customer at 390 × 780 with touch.
 *
 *  1. The phone hero on both shopfronts: the address and See my price
 *     stacked full width; the suggestions box positioned to overlay the
 *     chips, not push them (the test stack has no Places, so the box's
 *     placement is read from its style).
 *  2. Paint Group, from the hero: the Inside path through the phone's
 *     screens to the range, then Get my exact price → the scope editor.
 *  3. Paint Group: the Outside path — the exterior brief's screens as they
 *     are, inside the shell — to the range.
 *  4. Paint Home: the Outside path to the range, with Paint Home chrome.
 */
const db = serviceClient();

test.describe("Wizard mobile v5 — the phone, end to end on both shopfronts (session 7)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburbs = { pgIn: `E2E S7 PGIn ${run}`, pgOut: `E2E S7 PGOut ${run}`, phOut: `E2E S7 PHOut ${run}` };
  let phRoot = "";
  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.afterAll(async () => {
    if (!db) return;
    for (const s of Object.values(suburbs)) {
      const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", s);
      await db.from("wizard_drafts").delete().eq("suburb", s);
      for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
      await db.from("estimates").delete().ilike("title", `%${s}%`);
    }
  });

  /** The hero on a phone: stacked, and the suggestions box set to overlay. */
  const heroStacked = async (page: Page) => {
    const hero = page.locator("#top");
    const input = hero.getByRole("textbox", { name: "Address" });
    const btn = hero.getByRole("button", { name: "See my price →" });
    const ib = (await input.boundingBox())!, bb = (await btn.boundingBox())!, fb = (await hero.locator("form.field").boundingBox())!;
    expect(bb.y, "See my price sits under the address").toBeGreaterThanOrEqual(ib.y + ib.height - 1);
    expect(bb.width, "See my price is full width").toBeGreaterThan(fb.width * 0.85);
    expect(ib.width, "the address is most of the width").toBeGreaterThan(fb.width * 0.6);
    const sug = await hero.locator(".fieldwrap .suggest").evaluate((el) => ({ position: getComputedStyle(el).position, z: getComputedStyle(el).zIndex }));
    expect(sug.position, "the suggestions overlay (absolute), never pushing the chips").toBe("absolute");
    expect(Number(sug.z)).toBeGreaterThan(0);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w, "nothing wider than the phone").toBeLessThanOrEqual(390);
  };
  const fromHero = async (page: Page, root: string, scope: "Inside" | "Outside" | null) => {
    await page.goto(root);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await heroStacked(page);
    const hero = page.locator("#top");
    if (scope) await hero.getByRole("button", { name: scope }).tap();
    await hero.getByRole("textbox", { name: "Address" }).fill("14 Acacia Street, Northcote");
    await hero.getByRole("button", { name: "See my price →" }).tap();
    await expect(page).toHaveURL(/\/estimate\?/, { timeout: 20_000 });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
  };
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const toRange = async (page: Page, name: string) => {
    await at(page, "details");
    await page.getByTestId("gate-name").fill(name);
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`s7.${run}.${Date.now()}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`quick look submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    return gate;
  };

  test("1 · Paint Group from the hero: the stacked field, the Inside path to the range, Get my exact price → the editor", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await fromHero(page, baseURL!, null);
    await driveMobileQuickLook(page, { suburb: suburbs.pgIn, bedrooms: 3, colour: "same", condition: "good" });
    const gate = await toRange(page, "Seven Tester");
    await expect(gate).toHaveAttribute("data-variant", "exact");
    await expect(page.getByTestId("gate-basis")).toContainText(/same colours/);
    await expect(page.getByTestId("gate-basis")).toContainText(/good condition/);
    await expect(page.getByTestId("gate-tiles").locator("li").nth(2)).toContainText("In person, 40 min");
    await page.getByTestId("gate-bar-exact").tap();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 30_000 });
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId("wzm-tiles")).toHaveAttribute("data-at", "1");
    await expect(page.locator(".sc-card").first()).toBeVisible({ timeout: 90_000 });
  });

  test("2 · Paint Group, Outside: the exterior brief's screens inside the shell, to the range", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    await fromHero(page, baseURL!, null);
    const inside = await driveMobileQuickLook(page, { suburb: suburbs.pgOut, jobType: "exterior" });
    expect(inside).toBe(false);
    await at(page, "shape");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Outside · House");
    await answerOutsideQuick(page);
    await page.getByTestId("ql-next").tap();
    const gate = await toRange(page, "Seven Outside");
    await expect(gate).toHaveAttribute("data-variant", "exact");
    await expect(page.getByTestId("gate-exact")).toContainText("Side by side");
    await expect(page.getByTestId("gate-basis")).toContainText(/outside|side/i);
  });

  test("3 · Paint Home, Outside from the hero: the stacked field, the Outside chip, the exterior screens, the range in Paint Home chrome", async ({ page }) => {
    test.setTimeout(240_000);
    await fromHero(page, phRoot, "Outside");
    await at(page, "what");
    await expect(page.getByTestId("ql-jobtype-exterior")).toHaveAttribute("aria-pressed", "true");
    const inside = await driveMobileQuickLook(page, { suburb: suburbs.phOut, jobType: "exterior" });
    expect(inside).toBe(false);
    await at(page, "shape");
    await expect(page.locator(".wzm-head [data-testid='painthome-logo-nav']")).toBeVisible();
    await answerOutsideQuick(page);
    await page.getByTestId("ql-next").tap();
    await toRange(page, "Seven PaintHome");
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
    const without = await page.evaluate(() => { const p = document.querySelector("[data-testid='gate-powered']"); const t = document.body.innerText; return p ? t.replace(p.textContent ?? "", "") : t; });
    expect(without).not.toContain("Paint Group");
  });
});
