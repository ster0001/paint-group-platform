import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "../helpers";

/**
 * Estimates tab & funnel, session 5 (brief §4.5, R7, R13): the Funnel view on
 * a real wizard walk.
 *
 *  1. An ANONYMOUS customer walks the wizard on a phone (what → property →
 *     beds) and comes back to it. On Estimates → Funnel, filtered to phones,
 *     "Where they stop" counts one more session that saw Property and went
 *     on, and "Came back" one more session.
 *  2. Each chart's CSV downloads through the export route with the filters on.
 *
 * The test project holds other sessions, so the assertions are on the CHANGE
 * the walk makes; the counting itself is pinned by hand in
 * lib/reporting/metrics/funnelView.test.ts.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const suburb = `E2E Funnel5 ${run}`;

const num = async (page: Page, testId: string, inner: string) => Number((await page.getByTestId(testId).getByTestId(inner).textContent()) ?? "0");

test.describe("Estimates Funnel, session 5 — a real walk moves the charts", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("estimate_id").eq("suburb", suburb);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  test("an anonymous phone walk and a return show on the Funnel; the CSVs download", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const staffCtx = await browser.newContext();
    const page = await staffCtx.newPage();
    await signIn(page, staff!, /\/(home|estimates|crm|quote|$)/);
    const funnelUrl = "/estimates?view=funnel&preset=month&device=mobile";
    await page.goto(funnelUrl);
    await expect(page.getByTestId("funnel-view")).toBeVisible({ timeout: 30_000 });
    const propertyRow = "funnel-step-property";
    const before = {
      saw: (await page.getByTestId(propertyRow).count()) ? await num(page, propertyRow, "step-viewed") : 0,
      on: (await page.getByTestId(propertyRow).count()) ? await num(page, propertyRow, "step-completed") : 0,
      back: await num(page, "funnel-cameback-came_back", "cb-sessions"),
    };

    // The customer: no login, a phone, the wizard.
    const custCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    const cust = await custCtx.newPage();
    let draftId = "";
    cust.on("response", async (res) => {
      if (res.request().method() !== "POST" || !res.url().includes("/api/wizard/draft")) return;
      const j = await res.json().catch(() => null) as { id?: string } | null;
      if (j?.id) draftId = j.id;
    });
    const parts = new URLSearchParams({ street: "5 Funnel Street", suburb, state: "VIC", postcode: "3070", address: `5 Funnel Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await cust.goto(`${baseURL}/estimate?${parts.toString()}`);
    await cust.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(cust.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    const at = (id: string) => expect(cust.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 10_000 });
    await at("what");
    await cust.getByTestId("ql-jobtype-interior").tap();
    await at("property");
    await cust.getByTestId("ql-kind-house").tap();
    await at("beds");
    await expect.poll(() => draftId, { timeout: 15_000 }).not.toBe("");
    await cust.reload();
    await expect(cust.getByTestId("wz-resume")).toContainText("Welcome back", { timeout: 20_000 });
    await expect.poll(async () => {
      const { data, error } = await db!.from("wizard_drafts").select("visits").eq("id", draftId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { visits: number } | null)?.visits ?? 0;
    }, { timeout: 20_000 }).toBeGreaterThan(1);
    await expect.poll(async () => {
      const { count, error } = await db!.from("crm_events").select("id", { count: "exact", head: true }).eq("wizard_draft_id", draftId).eq("type", "wizard_step_completed").eq("payload->>step", "property");
      if (error) throw new Error(error.message);
      return count ?? 0;
    }, { timeout: 15_000 }).toBe(1);
    await custCtx.close();

    await page.goto(funnelUrl);
    await expect(page.getByTestId(propertyRow)).toBeVisible({ timeout: 30_000 });
    expect(await num(page, propertyRow, "step-viewed")).toBeGreaterThanOrEqual(before.saw + 1);
    expect(await num(page, propertyRow, "step-completed")).toBeGreaterThanOrEqual(before.on + 1);
    expect(await num(page, "funnel-cameback-came_back", "cb-sessions")).toBeGreaterThanOrEqual(before.back + 1);
    await expect(page.getByTestId("funnel-device-mobile")).toHaveAttribute("aria-pressed", "true");

    // Each chart's CSV, with the filter on the URL.
    for (const metric of ["funnel.step_conversion", "funnel.price_bands", "funnel.came_back"]) {
      const href = await page.getByTestId(`export-${metric}`).getAttribute("href");
      expect(href).toContain("device=mobile");
      const res = await page.request.get(href!);
      expect(res.status(), metric).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
    }
    await staffCtx.close();
  });
});
