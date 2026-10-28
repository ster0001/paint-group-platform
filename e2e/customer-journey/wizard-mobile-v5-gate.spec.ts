import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { MONEY_RANGE } from "./drive";

/**
 * Wizard mobile v5 — session 4 (brief §4, acceptance §9 items 7, 10, 11),
 * as an ANONYMOUS customer on a phone (390 × 780, touch) on painthome.localhost.
 *
 *  1. The gate: blocks 1–6 in order, no picture, no ± string, the small
 *     print present; the tiles; "What's in the range" lists the ticked
 *     surfaces only; the sticky bar holds Get my exact price alone; the
 *     page names Paint Group only in the powered-by line; the events.
 *  2. Get my exact price → /estimate/scope on the Paint Home host with
 *     Paint Home chrome and the three tiles, "Your exact price" active.
 *  3. The bigger-job variant (over the Paint Home ceiling): "We'll come and
 *     look" + Book a visit replace the question — never both.
 */
const db = serviceClient();
const SHOTS = process.env.WIZARD_MOBILE_SHOTS ? "docs/wizard-mobile" : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

test.describe("Wizard mobile v5 — the gate on a phone (session 4)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const suburb = `E2E PHGate ${run}`;
  let phRoot = "";
  let policyBefore: unknown = undefined;
  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
    await db.from("estimates").delete().ilike("title", `%${suburb}%`);
    if (policyBefore !== undefined) {
      if (policyBefore === null) await db.from("settings").delete().eq("key", "wizard_policy");
      else await db.from("settings").upsert({ key: "wizard_policy", value: policyBefore }, { onConflict: "key" });
    }
  });

  const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
  /** The phone's screens to the gate: 3-bed house, whole interior minus the ceilings, new colours, some wear, empty. */
  const toGate = async (page: Page, name: string) => {
    const parts = new URLSearchParams({ street: "14 Acacia Street", suburb, state: "VIC", postcode: "3070", address: `14 Acacia Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await page.goto(`${phRoot}/estimate?${parts.toString()}`);
    await page.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await at(page, "what");
    await page.getByTestId("ql-jobtype-interior").tap();
    await at(page, "property");
    await page.getByTestId("ql-kind-house").tap();
    await at(page, "beds");
    await page.getByTestId("ql-bedrooms-3").tap();
    await at(page, "storeys");
    await page.getByTestId("ql-storeys-single").tap();
    await at(page, "job");
    await page.getByTestId("ql-scope-whole").tap();
    await at(page, "surfaces");
    await page.getByTestId("ql-surface-ceilings").tap();
    await page.getByTestId("ql-next").tap();
    await at(page, "rooms");
    await page.getByTestId("ql-next").tap();
    await at(page, "colours");
    await page.getByTestId("ql-colours-new").tap();
    await at(page, "condition");
    await page.getByTestId("ql-condition-wear").tap();
    await at(page, "living");
    await page.getByTestId("ql-occupied-no").tap();
    await at(page, "details");
    await page.getByTestId("gate-name").fill(name);
    await page.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await page.getByTestId("gate-email").fill(`ph.gate.${run}.${Date.now()}@example.com`);
    await expect(page.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("ql-next").tap();
    const gate = page.getByTestId("wzm-gate");
    const bounced = page.locator(".wz-err");
    await expect(gate.or(bounced)).toBeVisible({ timeout: 90_000 });
    if (await bounced.count()) throw new Error(`quick look submit failed: ${await bounced.first().innerText()}`);
    return gate;
  };

  test("1 · blocks 1–6 in order, no picture, no tolerance promise, the small print, the tiles, the surfaces ticked, the bar, the events", async ({ page }) => {
    test.setTimeout(240_000);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/wizard/event")) {
        try { events.push(JSON.parse(req.postData() ?? "{}") as { type: string; payload: Record<string, unknown> }); } catch { /* not json */ }
      }
    });
    const gate = await toGate(page, "Mobile Gate");
    await expect(gate).toHaveAttribute("data-variant", "exact");
    // 1 · the range block
    await expect(page.getByTestId("gate-label")).toHaveText("Mobile, your range today");
    await expect(page.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    const font = await page.getByTestId("gate-range").evaluate((el) => ({ family: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
    // the app's mono token (Geist Mono today; the brief names Martian Mono, the prototype's) at 40px
    expect(font.family).toMatch(/Mono|monospace/i);
    expect(font.size).toBe("40px");
    await expect(page.getByTestId("gate-basis")).toContainText(/3-bedroom/);
    await expect(page.getByTestId("gate-fine")).toHaveText(/^Based on what you’ve told us — anything different on the day changes the price\. .+ confirms it with you before anything is fixed\. Includes GST\.$/);
    // 2 · the question
    await expect(page.getByTestId("gate-block-ask").getByRole("heading")).toHaveText("Want the exact number?");
    await expect(page.getByTestId("gate-exact")).toContainText("Get my exact price");
    await expect(page.getByTestId("gate-exact")).toContainText("Room by room · about 10 min");
    await expect(page.getByTestId("gate-visit")).toContainText(/book a time with .+ first/);
    await expect(page.getByTestId("gate-block-bigger")).toHaveCount(0);
    // 3 · the tiles, Your exact price active
    const tiles = page.getByTestId("gate-tiles").locator("li");
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveAttribute("data-state", "done");
    await expect(tiles.nth(0)).toContainText("Your range");
    await expect(tiles.nth(1)).toHaveAttribute("data-state", "now");
    await expect(tiles.nth(1)).toContainText("Your exact price");
    await expect(tiles.nth(2)).toContainText(/confirms/);
    // 4 · 5 · the person and the trust line
    await expect(page.getByTestId("gate-estimator")).toBeVisible();
    await expect(page.getByTestId("gate-trust")).toBeVisible();
    // 6 · what's in the range: the ticked surfaces only — the ceilings were unticked
    const incl = page.getByTestId("gate-included");
    await expect(incl).toBeVisible();
    await expect(incl.locator("summary")).toHaveText("What’s in the range");
    expect(await incl.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await incl.locator("summary").tap();
    await expect(incl.getByTestId("gate-included-walls")).toContainText(/\d coats?/);
    await expect(incl.getByTestId("gate-included-ceilings")).toHaveCount(0);
    // the order of the blocks on the page
    const order = await page.evaluate(() => ["gate-block-range", "gate-block-ask", "gate-tiles", "gate-estimator", "gate-trust", "gate-included"].map((t) => document.querySelector(`[data-testid='${t}']`)?.getBoundingClientRect().top ?? -1));
    for (let i = 1; i < order.length; i++) expect(order[i], `block ${i} sits under block ${i - 1}`).toBeGreaterThan(order[i - 1]);
    // no picture, no ± / within, no header rail, the strip gone
    await expect(page.locator(".wz-pic")).toHaveCount(0);
    await expect(page.getByTestId("wzm-strip")).toHaveCount(0);
    await expect(page.getByTestId("reveal")).toHaveCount(0);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/±|within \d+%/);
    // R10: Paint Group only in the powered-by line
    await expect(page.getByTestId("gate-powered")).toHaveText("Reviews powered by Paint Group");
    const without = await page.evaluate(() => { const p = document.querySelector("[data-testid='gate-powered']"); const t = document.body.innerText; return p ? t.replace(p.textContent ?? "", "") : t; });
    expect(without).not.toContain("Paint Group");
    // §4.1 the sticky bar: one button, on the bottom edge
    const bar = page.getByTestId("gate-bar");
    await expect(bar.locator("button")).toHaveCount(1);
    await expect(bar.getByTestId("gate-bar-exact")).toHaveText("Get my exact price");
    const b = (await bar.boundingBox())!;
    expect(Math.round(b.y + b.height)).toBe(780);
    if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/12-gate.png`, animations: "disabled" }); await page.screenshot({ path: `${SHOTS}/12-gate-full.png`, fullPage: true, animations: "disabled" }); }
    await expect.poll(() => events.some((e) => e.type === "gate_viewed" && e.payload.breakpoint === "mobile" && e.payload.bigger_job === false), { timeout: 10_000 }).toBe(true);
    // the door writes its event, then the scope
    await bar.getByTestId("gate-bar-exact").tap();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 30_000 });
    expect(events.some((e) => e.type === "gate_cta_clicked" && e.payload.cta === "exact" && e.payload.breakpoint === "mobile")).toBe(true);
  });

  test("2 · Get my exact price → the scope page on the Paint Home host, Paint Home chrome, the three tiles with Your exact price active", async ({ page }) => {
    test.setTimeout(240_000);
    await toGate(page, "Scope Tester");
    await page.getByTestId("gate-exact").tap();
    await expect(page).toHaveURL(/\/estimate\/scope\?id=/, { timeout: 30_000 });
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
    await expect(page.locator("[data-ready='1']")).toBeAttached({ timeout: 30_000 });
    // the Paint Home mark in the editor's frozen header, drawn (the inline SVG needs a height — it used to be zero-size)
    const mark = page.locator(".sc-freeze [data-testid='painthome-logo-nav']");
    await expect(mark).toBeVisible();
    expect((await mark.boundingBox())!.height).toBeGreaterThan(10);
    const tiles = page.getByTestId("wzm-tiles");
    await expect(tiles).toBeVisible();
    await expect(tiles).toHaveAttribute("data-at", "1");
    await expect(tiles.locator("li").nth(1)).toContainText("Your exact price");
    await expect(tiles.locator("li").nth(1)).toHaveAttribute("data-state", "now");
    await expect(page.locator("body")).not.toContainText("Paint Group");
    if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/13-scope.png`, animations: "disabled" }); }
  });

  test("3 · over the ceiling: We'll come and look + Book a visit replace the question — never both", async ({ page }) => {
    test.setTimeout(240_000);
    const { data: row } = await db!.from("settings").select("value").eq("key", "wizard_policy").maybeSingle();
    policyBefore = row ? row.value : null;
    const value = { ...((policyBefore as Record<string, unknown> | null) ?? {}), paintHomeCapCents: 100 };
    const { error } = await db!.from("settings").upsert({ key: "wizard_policy", value }, { onConflict: "key" });
    if (error) throw error;
    // the server's pricing context caches settings for 20s per process (lib/pricing/context.ts) — let it lapse
    await page.waitForTimeout(21_000);
    const gate = await toGate(page, "Bigger Job");
    await expect(gate).toHaveAttribute("data-variant", "bigger");
    await expect(page.getByTestId("gate-block-bigger").getByRole("heading")).toHaveText("We’ll come and look");
    await expect(page.getByTestId("gate-book")).toContainText("Book a visit");
    await expect(page.getByTestId("gate-block-ask")).toHaveCount(0);
    await expect(page.getByTestId("gate-exact")).toHaveCount(0);
    await expect(page.getByTestId("gate-bar").locator("button")).toHaveCount(1);
    await expect(page.getByTestId("gate-bar-book")).toHaveText("Book a visit");
    await expect(page.getByTestId("gate-tiles").locator("li").nth(2)).toHaveAttribute("data-state", "now");
    await expect(page.getByTestId("gate-fine")).toBeVisible();
    if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/12-gate-bigger.png`, animations: "disabled" }); }
    await page.getByTestId("gate-bar-book").tap();
    await expect(page).toHaveURL(/\/estimate\/visit\?id=/, { timeout: 20_000 });
    expect(new URL(page.url()).host).toMatch(/^painthome\.localhost/);
  });
});
