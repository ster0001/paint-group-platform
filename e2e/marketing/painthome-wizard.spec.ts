import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { passGateIfShown, quickNext } from "../customer-journey/drive";

/**
 * Paint Home brief §5 AC — the same wizard, two doors shut, as an anonymous
 * customer on a phone, from painthome.localhost (Chromium resolves *.localhost).
 *
 *  1. address → Inside → See my price → the wizard on the Paint Home host:
 *     the Paint Home mark in the header, no "Both", no commercial kind, the
 *     scope pre-answered → the quick look to the price → the one door is
 *     "Confirm my price. Book a call" (no site visit offered) → request the
 *     call → the session, the estimate and the hand-off all carry
 *     brand = painthome; the homes site's door set is unchanged.
 *  2. a Paint Home session that crosses the threshold lands on the hand-off
 *     screen with its answers intact — the ceiling is lowered for the run
 *     (wizard_policy on the test project) and restored after.
 */
const db = serviceClient();

test.describe("Paint Home — the wizard brand branch (session 3)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburbs = { call: `E2E PaintHome ${run}`, visit: `E2E PaintHomeBig ${run}` };
  let phRoot = "";
  let policyBefore: unknown = undefined;

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}/`;
  });
  test.afterAll(async () => {
    if (!db) return;
    for (const s of Object.values(suburbs)) {
      const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", s);
      await db.from("wizard_drafts").delete().eq("suburb", s);
      for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
      await db.from("estimates").delete().ilike("title", `%${s}%`);
    }
    if (policyBefore !== undefined) {
      if (policyBefore === null) await db.from("settings").delete().eq("key", "wizard_policy");
      else await db.from("settings").upsert({ key: "wizard_policy", value: policyBefore }, { onConflict: "key" });
    }
  });

  /**
   * From the Paint Home hero to the range: Inside, the fixture address, the quick look, the gate.
   * Wizard mobile v5 (S2, 28 Oct 2026): at 375px the quick look is the phone's shell — one
   * question per screen, single choices advancing themselves (e2e/customer-journey/wizard-mobile-v5.spec.ts).
   */
  async function driveToRange(page: Page, suburb: string, scope: "Inside" | "Outside" = "Inside") {
    await page.goto(phRoot);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    const hero = page.locator("#top");
    await hero.getByRole("button", { name: scope }).tap();
    await hero.getByRole("textbox", { name: "Address" }).fill("14 Acacia Street, Northcote");
    await hero.getByRole("button", { name: "See my price →" }).tap();
    await expect(page).toHaveURL(/\/estimate\?/, { timeout: 20_000 });
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-mobile-screen='what']")).toBeVisible({ timeout: 20_000 });
    // §5: the scope is pre-answered and editable; there is no "Both"; no Paint Group in the header
    const jobType = scope === "Inside" ? "interior" : "exterior";
    await expect(page.getByTestId(`ql-jobtype-${jobType}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("ql-jobtype-both")).toHaveCount(0);
    await expect(page.locator("header [data-testid='painthome-logo-nav']")).toBeVisible();
    await expect(page.getByTestId("wzm-head")).not.toContainText("Paint Group");
    // words alone (no Places on the test stack): the suburb and postcode boxes carry the handle
    await page.getByPlaceholder("Suburb").fill(suburb);
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId(`ql-jobtype-${jobType}`).tap();
    // the place: residential kinds only
    await expect(page.locator("[data-mobile-screen='property']")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-quick-step='place']")).toBeVisible();
    await expect(page.getByTestId("ql-kind-commercial")).toHaveCount(0);
    await expect(page.getByTestId("ql-kind-house")).toBeVisible();
    await page.getByTestId("ql-kind-house").tap();
    await expect(page.locator("[data-mobile-screen='beds']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-bedrooms-3").tap();
    await expect(page.locator("[data-mobile-screen='storeys']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-storeys-single").tap();
    await expect(page.locator("[data-mobile-screen='job']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-scope-whole").tap();
    await expect(page.locator("[data-mobile-screen='surfaces']")).toBeVisible({ timeout: 20_000 });
    await quickNext(page);
    await expect(page.locator("[data-quick-step='rooms']")).toBeVisible({ timeout: 30_000 });
    await quickNext(page);
    await expect(page.locator("[data-mobile-screen='colours']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-colours-new").tap();
    await expect(page.locator("[data-mobile-screen='condition']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-condition-wear").tap();
    await expect(page.locator("[data-mobile-screen='living']")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("ql-occupied-no").tap();
    await passGateIfShown(page, { name: "Paint Home Tester", email: `ph.${run}@example.com` });
    // Wizard mobile v5 S4: on a phone the range is the mobile gate (brief §4), not the desktop range card.
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`quick look submit failed: ${await bounced.first().innerText()}`);
    await expect(page.getByTestId("gate-range")).toHaveText(/\$[\d,]+\s*–\s*\$[\d,]+/);
    return (await gate.getAttribute("data-estimate-id")) ?? "";
  }

  test("1 · Inside → the wizard on Paint Home: two doors shut, the price, the exact-price door (no site visit), brand on the session and the estimate", async ({ page }) => {
    test.setTimeout(240_000);
    const estimateId = await driveToRange(page, suburbs.call, "Inside");
    // §5 on the phone's gate: the exact price is offered, no hand-off, "book a time" is the one other door
    await expect(page.getByTestId("wzm-gate")).toHaveAttribute("data-variant", "exact");
    await expect(page.getByTestId("gate-exact")).toContainText("Get my exact price");
    await expect(page.getByTestId("gate-block-bigger")).toHaveCount(0);
    await expect(page.getByTestId("gate-tiles").locator("li").nth(2)).toContainText("On one short call");
    // wizard mobile v5 R10: nothing on the page names Paint Group except the powered-by line
    const without = await page.evaluate(() => { const p = document.querySelector("[data-testid='gate-powered']"); const t = document.body.innerText; return p ? t.replace(p.textContent ?? "", "") : t; });
    expect(without).not.toContain("Paint Group");
    // "book a time first" opens the talk sheet in call mode (session 5 brings the Contact sheet)
    await page.getByTestId("gate-visit").tap();
    const sheet = page.getByTestId("talk-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("call");
    await page.keyboard.press("Escape");

    // the brand is on the session, the estimate — and the autosave caught up
    await expect.poll(async () => {
      const { data } = await db!.from("wizard_drafts").select("brand, mode, entry_source").eq("suburb", suburbs.call).maybeSingle();
      return data;
    }, { timeout: 30_000, intervals: [2_000] }).toMatchObject({ brand: "painthome", mode: "home", entry_source: "painthome_home_hero" });
    const { data: est } = await db!.from("estimates").select("brand, source").eq("id", estimateId).single();
    expect(est).toMatchObject({ brand: "painthome", source: "customer_intake" });
  });

  test("2 · over the threshold: the Paint Home hand-off, answers intact, a site visit to book", async ({ page }) => {
    test.setTimeout(240_000);
    // Lower the phone-close ceiling for this run; restored in afterAll.
    const { data: row } = await db!.from("settings").select("value").eq("key", "wizard_policy").maybeSingle();
    policyBefore = row ? row.value : null;
    const value = { ...((policyBefore as Record<string, unknown> | null) ?? {}), paintHomeCapCents: 100 };
    const { error } = await db!.from("settings").upsert({ key: "wizard_policy", value }, { onConflict: "key" });
    if (error) throw error;

    const estimateId = await driveToRange(page, suburbs.visit, "Inside");
    // Wizard mobile v5 §4.2: over the ceiling the phone's gate is the bigger-job variant — no exact-price door, Book a visit only
    const gate = page.getByTestId("wzm-gate");
    await expect(gate).toHaveAttribute("data-variant", "bigger");
    await expect(page.getByTestId("gate-block-bigger")).toContainText("We’ll come and look");
    await expect(page.getByTestId("gate-exact")).toHaveCount(0);
    await expect(page.getByTestId("gate-visit")).toHaveCount(0);
    // the answers are kept: the estimate exists with its range, and the basis line reads them back
    await expect(page.getByTestId("gate-basis")).toContainText(/bed|room|storey|house/i);
    const { data: est } = await db!.from("estimates").select("brand, total_cents").eq("id", estimateId).single();
    expect(est?.brand).toBe("painthome");
    expect(est?.total_cents).toBeGreaterThan(0);
    await page.getByTestId("gate-book").tap();
    await expect(page).toHaveURL(new RegExp(`/estimate/visit\\?id=${estimateId}`), { timeout: 20_000 });
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
  });

  test("3 · the Paint Group wizard is untouched: Both and Commercial are offered, and the range keeps its site-visit door", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/estimate?address=14%20Acacia%20Street&mode=home&src=homepage_hero`);
    await expect(page.locator("[data-quick-step='start']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ql-jobtype-both")).toBeVisible();
    await expect(page.locator("header [data-testid='painthome-logo-nav']")).toHaveCount(0);
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    await page.getByTestId("ql-jobtype-interior").tap();
    await expect(page.locator("[data-mobile-screen='property']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ql-kind-commercial")).toBeVisible();
  });
});
