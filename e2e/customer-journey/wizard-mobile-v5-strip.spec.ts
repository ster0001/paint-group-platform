import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Wizard mobile v5 — session 3 (brief §3, acceptance §9 items 4–6), as an
 * ANONYMOUS customer on a phone (390 × 780, touch) on painthome.localhost.
 *
 *  1. The strip: a 76 × 52 thumbnail, the ribbon (§2.2) and a chevron; the
 *     ribbon reads the answers so far on a full Inside run.
 *  2. Ticking a surface chip sweeps that surface in IN THE THUMBNAIL without
 *     opening the sheet; unticking wipes it back; reduced motion snaps.
 *  3. The sheet: the same picture at 5:3, the caption, the same chips —
 *     a tick in the sheet ticks the step's chip, both pictures and the count.
 *  4. The variants: unit, townhouse, two storeys, the three tints, the two
 *     condition marks (screenshots with WIZARD_MOBILE_SHOTS=1).
 *  5. Outside: the house, drawn from the exterior brief's parts.
 *  6. `surface_toggled {surface, on}` is written for every tick.
 */
const db = serviceClient();
const SHOTS = process.env.WIZARD_MOBILE_SHOTS ? "docs/wizard-mobile/variants" : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.describe("Wizard mobile v5 — the live strip, thumbnail and roller (session 3)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburb = `E2E PHStrip ${run}`;
  let phRoot = "";
  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  const open = async (page: Page, scope: "interior" | "exterior" = "interior") => {
    const parts = new URLSearchParams({ street: "14 Acacia Street", suburb, state: "VIC", postcode: "3070", address: `14 Acacia Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope });
    await page.goto(`${phRoot}/estimate?${parts.toString()}`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId("wzm")).toBeVisible({ timeout: 20_000 });
  };
  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  const thumb = (page: Page) => page.getByTestId("wzm-thumb").locator("svg[data-testid='wzm-pic']");
  const rectWidth = (page: Page, where: "wzm-thumb" | "wzm-bigpic", surf: string) =>
    page.locator(`[data-testid='${where}'] [data-surf='${surf}'] rect.cprect`).evaluate((r) => Number(r.getAttribute("width")));
  const shot = async (page: Page, name: string) => {
    if (!SHOTS) return;
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });
  };

  /** To the surfaces screen of a house: Inside → House → beds → storeys → whole interior. */
  const toSurfaces = async (page: Page, o: { beds?: number; storeys?: "single" | "double"; kind?: string } = {}) => {
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId(`ql-kind-${o.kind ?? "house"}`).tap();
    await at(page, "beds");
    await page.getByTestId(`ql-bedrooms-${o.beds ?? 3}`).tap();
    if ((o.kind ?? "house") !== "unit_apartment") {
      await at(page, "storeys");
      await page.getByTestId(`ql-storeys-${o.storeys ?? "single"}`).tap();
    }
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
  };

  test("1 · the strip: a 76 × 52 thumbnail, the ribbon and a chevron, the ribbon reading the answers so far", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page);
    await at(page, "what");
    const strip = page.getByTestId("wzm-strip");
    await expect(strip).toBeVisible();
    const tb = (await page.getByTestId("wzm-thumb").boundingBox())!;
    expect(Math.round(tb.width)).toBe(76);
    expect(Math.round(tb.height)).toBe(52);
    await expect(page.getByTestId("wzm-chev")).toBeVisible();
    await expect(thumb(page)).toHaveAttribute("data-kind", "room");
    await expect(thumb(page)).toHaveAttribute("data-painted", "false");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Your place");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("Updates as you answer · tap to see");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Inside");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Inside · House");
    await page.getByTestId("ql-bedrooms-3").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-double").tap();
    await at(page, "job");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Inside · House · 3 bed · Two storeys");
    await expect(thumb(page)).toHaveAttribute("data-two", "true");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Inside · House · 3 bed · Two storeys · Whole interior");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("6 surfaces ticked · tap to see");
    await expect(thumb(page)).toHaveAttribute("data-painted", "true");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText(/^Inside · House · 3 bed · Two storeys · Whole interior · \d+ rooms$/);
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-wear").tap();
    await at(page, "living");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText(/^Inside · House · 3 bed · Two storeys · Whole interior · \d+ rooms · New colours · Some wear$/);
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("6 surfaces ticked · tap to see");
    // §3.5: the ticks persist through colours and condition
    await expect(thumb(page).locator("[data-surf='walls']")).toHaveAttribute("data-on", "true");
  });

  test("2 · a tick sweeps the surface in IN THE THUMBNAIL, no sheet; unticking wipes it back; reduced motion snaps", async ({ page }) => {
    test.setTimeout(120_000);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/wizard/event")) {
        try { events.push(JSON.parse(req.postData() ?? "{}") as { type: string; payload: Record<string, unknown> }); } catch { /* not json */ }
      }
    });
    await open(page);
    await toSurfaces(page);
    // everything ticked: every painted layer is fully in
    for (const k of ["walls", "ceilings", "skirting", "doors", "windows"]) {
      await expect(thumb(page).locator(`[data-surf='${k}']`)).toHaveAttribute("data-on", "true");
      expect(await rectWidth(page, "wzm-thumb", k)).toBe(200);
    }
    await page.getByTestId("ql-surface-ceilings").tap();
    await expect(page.getByTestId("wzm-sheet")).toHaveCount(0);
    await expect(thumb(page).locator("[data-surf='ceilings']")).toHaveAttribute("data-on", "false");
    // the roller wipes it back over ~520ms: mid-way it is part way, then gone
    await page.waitForTimeout(150);
    const mid = await rectWidth(page, "wzm-thumb", "ceilings");
    expect(mid, "the wipe is under way, not a snap").toBeGreaterThan(0);
    expect(mid).toBeLessThan(200);
    await expect.poll(() => rectWidth(page, "wzm-thumb", "ceilings"), { timeout: 3_000 }).toBe(0);
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("5 surfaces ticked · tap to see");
    await page.getByTestId("ql-surface-ceilings").tap();
    await expect.poll(() => rectWidth(page, "wzm-thumb", "ceilings"), { timeout: 3_000 }).toBe(200);
    // reduced motion: a snap, no sweep
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("ql-surface-walls").tap();
    await page.waitForTimeout(60);
    expect(await rectWidth(page, "wzm-thumb", "walls")).toBe(0);
    await page.getByTestId("ql-surface-walls").tap();
    await page.waitForTimeout(60);
    expect(await rectWidth(page, "wzm-thumb", "walls")).toBe(200);
    const toggled = events.filter((e) => e.type === "surface_toggled").map((e) => `${e.payload.surface}:${e.payload.on}`);
    expect(toggled).toEqual(["ceilings:false", "ceilings:true", "walls:false", "walls:true"]);
  });

  test("3 · the sheet: the picture at 5:3, the caption, the same chips — a tick there ticks the step, both pictures and the count", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await toSurfaces(page);
    await page.getByTestId("wzm-strip").tap();
    const sheet = page.getByTestId("wzm-sheet");
    await expect(sheet).toBeVisible();
    const big = (await page.getByTestId("wzm-bigpic").boundingBox())!;
    expect(Math.abs(big.width / big.height - 5 / 3)).toBeLessThan(0.03);
    await expect(page.getByTestId("wzm-cap")).toHaveText("Tap a surface to paint it in or out.");
    for (const k of ["walls", "ceilings", "skirting", "doors", "windows", "architraves"]) await expect(page.getByTestId(`wzm-sheet-chip-${k}`)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("wzm-sheet-chip-doors").tap();
    await expect(page.getByTestId("wzm-sheet-chip-doors")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-testid='wzm-bigpic'] [data-surf='doors']")).toHaveAttribute("data-on", "false");
    await expect(thumb(page).locator("[data-surf='doors']")).toHaveAttribute("data-on", "false");
    await expect.poll(() => rectWidth(page, "wzm-bigpic", "doors"), { timeout: 3_000 }).toBe(0);
    await expect.poll(() => rectWidth(page, "wzm-thumb", "doors"), { timeout: 3_000 }).toBe(0);
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("5 surfaces ticked · tap to see");
    await page.getByTestId("wzm-sheet-x").tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("ql-surface-doors")).toHaveAttribute("aria-pressed", "false");
    // the step's chip ticks it back, and the sheet agrees when reopened
    await page.getByTestId("ql-surface-doors").tap();
    await page.getByTestId("wzm-strip").tap();
    await expect(page.getByTestId("wzm-sheet-chip-doors")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("4 · the variants: unit, townhouse, two storeys, three tints, two condition marks", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page);
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-unit_apartment").tap();
    await at(page, "beds");
    await expect(thumb(page)).toHaveAttribute("data-property", "unit_apartment");
    await shot(page, "unit");
    await page.getByTestId("wzm-back").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-townhouse").tap();
    await at(page, "beds");
    await expect(thumb(page)).toHaveAttribute("data-property", "townhouse");
    await shot(page, "townhouse");
    await page.getByTestId("ql-bedrooms-2").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-double").tap();
    await at(page, "job");
    await expect(thumb(page)).toHaveAttribute("data-two", "true");
    await shot(page, "two-storeys");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    for (const c of ["new", "same", "deciding"] as const) {
      await page.getByTestId(`ql-colours-${c}`).tap();
      await at(page, "condition");
      await expect(thumb(page)).toHaveAttribute("data-colour", c);
      await shot(page, `colour-${c}`);
      await page.getByTestId("wzm-back").tap();
      await at(page, "colours");
    }
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "condition");
    for (const c of ["wear", "needs_work", "good"] as const) {
      await page.getByTestId(`ql-condition-${c}`).tap();
      await at(page, "living");
      await expect(thumb(page)).toHaveAttribute("data-condition", c);
      await expect(thumb(page).locator("[data-marks]")).toHaveCount(c === "good" ? 0 : 1);
      await shot(page, `condition-${c}`);
      await page.getByTestId("wzm-back").tap();
      await at(page, "condition");
    }
  });

  test("5 · outside: the house, painted from the exterior brief's parts, the ribbon counting them", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, "exterior");
    await at(page, "what");
    await page.getByTestId("ql-jobtype-exterior").tap();
    await at(page, "property");
    await expect(thumb(page)).toHaveAttribute("data-kind", "house");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "home");
    await expect(page.getByTestId("wzm-ribbon-1")).toHaveText("Outside · House");
    await page.getByTestId("ql-ext-type-ds").click();
    await page.getByTestId("ql-ext-size-md").click();
    await expect(thumb(page)).toHaveAttribute("data-two", "true");
    await page.getByTestId("ql-next").tap();
    await at(page, "paint");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("0 parts ticked · tap to see");
    await page.getByTestId("ext-part-walls").click();
    await page.getByTestId("ext-part-gutters").click();
    await expect(thumb(page).locator("[data-surf='walls']")).toHaveAttribute("data-on", "true");
    await expect(thumb(page).locator("[data-surf='gutters']")).toHaveAttribute("data-on", "true");
    await expect(thumb(page).locator("[data-surf='doors']")).toHaveAttribute("data-on", "false");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("2 parts ticked · tap to see");
    // the sheet's chip toggles the part on the step
    await page.getByTestId("wzm-strip").tap();
    await page.getByTestId("wzm-sheet-chip-doors").tap();
    await page.getByTestId("wzm-sheet-x").tap();
    await expect(page.getByTestId("ext-part-doors")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("wzm-ribbon-2")).toHaveText("3 parts ticked · tap to see");
    await shot(page, "outside-house");
  });
});
