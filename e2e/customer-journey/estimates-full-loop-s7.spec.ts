import { expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { serviceClient } from "../fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "../helpers";
import { MONEY_RANGE, passOtpIfShown, quickNext } from "./drive";

/**
 * Estimates tab & funnel, session 7 (brief §6 row 7): the full loop, as an
 * ANONYMOUS customer on a phone, with the office watching.
 *
 *   wizard → drop out → come back by a link → details → the range → staff view
 *
 *  1. The customer starts (what → property → beds). Staff: Online now lists
 *     them live, with the step they are on.
 *  2. They drop out: the tab closes and the session goes quiet. Staff: they
 *     are no longer under Online now.
 *  3. They come back by a link (a bare /estimate, as a texted or emailed link
 *     is): "Welcome back", the session counts a second visit and the log has
 *     wizard_session_resumed.
 *  4. They finish the questions, give their details, pass the texted code
 *     and see their range (gate_viewed with the range in cents).
 *  5. Staff: Online now shows them live again with "Came back ×1"; the
 *     Funnel's Came back row counts one more; the Pipeline has their card,
 *     reading Came back ×1.
 *
 * The quiet spell in step 2 is the session's last_seen_at moved back an
 * hour through the service key — the one thing a test cannot wait for.
 */
const db = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(3).toString("hex");
const suburb = `E2E Loop7 ${run}`;
const NAME = `Loop Tester ${run}`;

const at = (page: Page, id: string) => expect(page.locator(`[data-mobile-screen='${id}']`)).toBeVisible({ timeout: 30_000 });

test.describe("Estimates tab — the full loop (session 7)", () => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  test.afterAll(async () => {
    if (!db) return;
    const { data: rows } = await db.from("wizard_drafts").select("id, estimate_id").eq("suburb", suburb);
    for (const r of rows ?? []) await db.from("crm_events").delete().eq("wizard_draft_id", r.id);
    await db.from("wizard_drafts").delete().eq("suburb", suburb);
    for (const r of rows ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  test("wizard → drop → back by a link → range → the office sees all of it", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const staffCtx = await browser.newContext();
    const office = await staffCtx.newPage();
    await signIn(office, staff!, /\/(home|estimates|crm|quote|$)/);
    await office.goto("/estimates?view=funnel&preset=month");
    await expect(office.getByTestId("funnel-view")).toBeVisible({ timeout: 30_000 });
    const backBefore = Number(await office.getByTestId("funnel-cameback-came_back").getByTestId("cb-sessions").textContent());

    // 1 · the customer starts, on a phone, with no login.
    const custCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    let cust = await custCtx.newPage();
    let draftId = "";
    const watch = (p: Page) => p.on("response", async (res) => {
      if (res.request().method() !== "POST" || !res.url().includes("/api/wizard/draft")) return;
      const j = await res.json().catch(() => null) as { id?: string } | null;
      if (j?.id) draftId = j.id;
    });
    watch(cust);
    const parts = new URLSearchParams({ street: "7 Loop Street", suburb, state: "VIC", postcode: "3070", address: `7 Loop Street, ${suburb} VIC 3070`, mode: "home", src: "homepage_hero", scope: "interior" });
    await cust.goto(`${baseURL}/estimate?${parts.toString()}`);
    await cust.getByTestId("consent-decline").click({ timeout: 3_000 }).catch(() => {});
    await expect(cust.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await at(cust, "what");
    await cust.getByTestId("ql-jobtype-interior").tap();
    await at(cust, "property");
    await cust.getByTestId("ql-kind-house").tap();
    await at(cust, "beds");
    await expect.poll(() => draftId, { timeout: 15_000 }).not.toBe("");

    await office.goto("/estimates?view=online");
    await expect(office.getByTestId("online-online").getByTestId(`online-row-${draftId}`)).toBeVisible({ timeout: 30_000 });

    // 2 · they drop out: the tab goes, and the session goes quiet for an hour.
    await cust.close();
    const quiet = await db!.from("wizard_drafts").update({ last_seen_at: new Date(Date.now() - 60 * 60_000).toISOString() }).eq("id", draftId);
    if (quiet.error) throw new Error(quiet.error.message);
    await office.reload();
    await expect(office.getByTestId("online-online").getByTestId(`online-row-${draftId}`)).toHaveCount(0);

    // 3 · back by a link: a bare /estimate in the same browser.
    cust = await custCtx.newPage();
    watch(cust);
    await cust.goto(`${baseURL}/estimate`);
    await expect(cust.locator("[data-ready='1']")).toBeAttached({ timeout: 20_000 });
    await expect(cust.getByTestId("wz-resume")).toContainText("Welcome back", { timeout: 20_000 });
    await at(cust, "beds");
    await expect.poll(async () => {
      const { data, error } = await db!.from("wizard_drafts").select("visits").eq("id", draftId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { visits: number } | null)?.visits ?? 0;
    }, { timeout: 20_000, message: "the return counts a second visit" }).toBe(2);
    await expect.poll(async () => {
      const { count, error } = await db!.from("crm_events").select("id", { count: "exact", head: true }).eq("wizard_draft_id", draftId).eq("type", "wizard_session_resumed");
      if (error) throw new Error(error.message);
      return count ?? 0;
    }, { timeout: 20_000 }).toBe(1);

    // 4 · the rest of the questions, their details, the code, the range.
    await cust.getByTestId("ql-bedrooms-3").click();
    await at(cust, "storeys");
    await cust.getByTestId("ql-storeys-single").click();
    await at(cust, "job");
    await cust.getByTestId("ql-scope-whole").click();
    await at(cust, "surfaces");
    await quickNext(cust);
    await at(cust, "rooms");
    await quickNext(cust);
    await at(cust, "colours");
    await cust.getByTestId("ql-colours-same").click();
    await at(cust, "condition");
    await cust.getByTestId("ql-condition-good").click();
    await at(cust, "living");
    await cust.getByTestId("ql-occupied-no").click();
    await at(cust, "details");
    await cust.getByTestId("gate-name").fill(NAME);
    await cust.getByTestId("gate-mobile").fill(`04${String(Date.now()).slice(-8)}`);
    await cust.getByTestId("gate-email").fill(`pg.e2e.loop7.${run}@example.com`);
    await expect(cust.getByTestId("ql-next")).toBeEnabled({ timeout: 30_000 });
    await cust.getByTestId("ql-next").tap();
    await passOtpIfShown(cust);
    await expect(cust.getByTestId("wzm-gate")).toBeVisible({ timeout: 90_000 });
    await expect(cust.getByTestId("gate-range")).toHaveText(MONEY_RANGE);
    await expect.poll(async () => {
      const { data, error } = await db!.from("crm_events").select("payload").eq("wizard_draft_id", draftId).eq("type", "gate_viewed").limit(1);
      if (error) throw new Error(error.message);
      const p = (data?.[0]?.payload ?? null) as { range_low?: number; range_high?: number } | null;
      return p && typeof p.range_low === "number" && typeof p.range_high === "number" && p.range_high >= p.range_low;
    }, { timeout: 20_000, message: "the range is on the log in cents" }).toBe(true);

    // 5 · the office.
    await office.goto("/estimates?view=online");
    const row = office.getByTestId("online-online").getByTestId(`online-row-${draftId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Came back ×1");
    await expect(row).toContainText(NAME);

    await office.goto("/estimates?view=funnel&preset=month");
    await expect(office.getByTestId("funnel-view")).toBeVisible({ timeout: 30_000 });
    expect(Number(await office.getByTestId("funnel-cameback-came_back").getByTestId("cb-sessions").textContent())).toBeGreaterThanOrEqual(backBefore + 1);

    await office.goto("/estimates?view=pipeline");
    const card = office.getByTestId("pipeline").locator('[data-testid^="pipeline-card-"]', { hasText: NAME });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Came back ×1");

    await custCtx.close(); await staffCtx.close();
  });
});
