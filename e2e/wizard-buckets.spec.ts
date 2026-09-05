import { test, expect, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { credentials, signIn } from "./helpers";
import { driveNoPlanWizard, openScopeEditor } from "./customer-journey/drive";

/**
 * Buckets brief §8 — two journeys, as an anonymous customer on a phone.
 *
 *  1. Start from the homepage hand-off, answer three pages, leave. The
 *     session heartbeats while the tab is open; the 30-minute sweep (run
 *     here with minutes=0) files it as Dropped · Condition with "3 of 6"
 *     and time > 0; the Estimates page shows the pill and the Journey; the
 *     CRM's "Dropped this week" counts it under Condition.
 *  2. Finish, see the price, request a call → Ready · call, and a "Call …
 *     — confirm price" item on Today.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.CRON_SECRET;
const staff = credentials("STAFF");
const missing = !url || !serviceKey || !SECRET || !staff;

test.describe("wizard sessions → buckets", () => {
  test.skip(missing, "needs the test project's service key, CRON_SECRET and E2E_STAFF_* creds");
  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const dropAddress = `12 Elm Street, Malvern VIC 3144 e2e${stamp}`;
  const finishEmail = `e2e-buckets-${stamp}@example.com`;

  test.afterAll(async () => {
    if (!db) return;
    await db.from("wizard_drafts").delete().eq("address", dropAddress);
    const { data: fin } = await db.from("wizard_drafts").select("estimate_id").eq("email", finishEmail);
    await db.from("wizard_drafts").delete().eq("email", finishEmail);
    for (const r of fin ?? []) if (r.estimate_id) await db.from("estimates").delete().eq("id", r.estimate_id);
  });

  test("three pages then gone: the sweep files Dropped · Condition, 3 of 6, with time on the page", async ({ browser, request }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto(`/estimate?address=${encodeURIComponent(dropAddress)}&mode=home&src=homepage_hero`);
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByPlaceholder("Suburb").fill("Malvern");
    await page.getByPlaceholder("Postcode").fill("3144");
    const next = async () => { await page.getByRole("button", { name: /Continue|Nearly there/ }).first().click(); };
    await next(); // → 2 Surfaces
    await next(); // → 3 Condition
    // Attention: a tap now and again, long enough for two heartbeats (15 s each).
    for (let i = 0; i < 4; i++) { await page.mouse.click(10, 10); await page.waitForTimeout(8_500); }
    await ctx.close();

    const { data: before } = await db!.from("wizard_drafts").select("id, bucket, furthest_page, active_seconds, entry_source, mode, step_times").eq("address", dropAddress).maybeSingle();
    expect(before, "the session row exists from the first answer, no email needed").toBeTruthy();
    expect(before!.entry_source).toBe("homepage_hero");
    expect(before!.mode).toBe("home");
    expect(before!.furthest_page).toBe(3);
    expect(before!.active_seconds).toBeGreaterThanOrEqual(15);
    expect(before!.bucket).toBe("online_now"); // still within the 45-minute window

    // The sweep, with the window collapsed to zero.
    const res = await request.get("/api/cron/wizard-sweep?minutes=0", { headers: { authorization: `Bearer ${SECRET}` } });
    expect(res.status()).toBe(200);
    const { data: afterRow } = await db!.from("wizard_drafts").select("id, bucket, dropped_at, step_times, active_seconds").eq("address", dropAddress).single();
    const after = afterRow!;
    expect(after.bucket).toBe("dropped");
    expect(after.dropped_at).toBeTruthy();
    const sum = Object.values((after.step_times ?? {}) as Record<string, number>).reduce((s, n) => s + n, 0);
    expect(Math.abs(sum - after.active_seconds)).toBeLessThanOrEqual(15);

    // Staff: the Estimates page's Wizard tab, the pill, the Journey drawer.
    const staffPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await signIn(staffPage, staff!, /\/estimates/);
    await staffPage.goto("/estimates?status=wizard&bucket=dropped");
    const pill = staffPage.getByTestId(`wizard-pill-${after.id}`);
    await expect(pill).toContainText("Dropped · Condition");
    await expect(staffPage.getByTestId(`wizard-line-${after.id}`)).toContainText("3 of 6");
    await pill.click();
    const drawer = staffPage.getByTestId("journey-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("journey-bucket")).toHaveText("Dropped · Condition");
    await expect(drawer.getByTestId("journey-steps").locator("li[data-reached='1']")).toHaveCount(3);
    await expect(drawer).toContainText("homepage_hero");
    await staffPage.keyboard.press("Escape");

    // CRM: Dropped this week, grouped by the page they stopped on.
    await staffPage.goto("/crm/today");
    const dropped = staffPage.getByTestId("dropped-this-week");
    await expect(dropped).toBeVisible();
    await expect(dropped.getByTestId("dropped-group").filter({ hasText: "Condition" })).toHaveCount(1);
    await expect(dropped.getByTestId("dropped-row").filter({ hasText: "Malvern" }).first()).toBeVisible();

    // Tom, 6 Sep: the board carries the buckets as lanes — the session, with
    // no account yet, is a card in "Dropped out".
    await staffPage.goto("/crm/customers?view=board&f=leads");
    const lane = staffPage.locator(".lane", { has: staffPage.locator(".lanename", { hasText: "Dropped out" }) });
    await expect(lane).toBeVisible();
    const card = lane.locator(".card", { hasText: `e2e${stamp}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText("3 of 6");
    await expect(card).toHaveAttribute("href", `/estimates?status=wizard&open=${after.id}`);
  });

  test("finish, see the price, request a call: Ready · call, and a Call item on Today", async ({ browser }) => {
    test.setTimeout(420_000);
    // Desktop for the confirm-loop walk (the ladder spec's viewport); the
    // phone layout's sticky footer covers the lower cards' buttons.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await driveNoPlanWizard(page, { email: finishEmail, settleAfterContactMs: 3_000 });
    await openScopeEditor(page);
    // The confirm loop (the ladder spec's walk), then "Finalise my price" → request a call.
    const cards = page.locator(".sc-rc[data-room]");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      await card.scrollIntoViewIfNeeded();
      await card.getByRole("button", { name: /Looks right/ }).click();
      const cup = card.locator(".il-cup");
      if (await cup.count()) await cup.getByRole("button", { name: "No", exact: true }).click();
      await card.locator(".il-confirm").click();
      await expect(card).toHaveClass(/done/, { timeout: 15_000 });
    }
    const dw = page.locator(".il-card", { hasText: /doors & windows/i });
    await dw.getByRole("button", { name: /That.s right/ }).click();
    await dw.getByRole("button", { name: /Confirm counts/ }).click();
    const sweep = page.locator(".il-card", { hasText: /anything we haven.t listed/i });
    await sweep.getByRole("button", { name: /No — that.s everything/ }).click();
    await sweep.getByRole("button", { name: /Confirm — nothing missing/ }).click();
    const cta = page.locator(".il-cta");
    await expect(cta).toBeEnabled({ timeout: 45_000 });
    await cta.click();
    await expect(page.getByTestId("contact-card")).toBeVisible();
    await page.getByTestId("contact-callback").click();
    await page.getByTestId("contact-phone").fill("0400 000 111");
    await page.getByTestId("contact-send").click();
    await expect(page.locator(".sc-tier")).toContainText(/call/i, { timeout: 15_000 });
    await ctx.close();

    await expect.poll(async () => (await db!.from("wizard_drafts").select("bucket").eq("email", finishEmail).maybeSingle()).data?.bucket, { timeout: 15_000 }).toBe("ready_call");
    const { data: rowData } = await db!.from("wizard_drafts").select("id, outcome, converted_at, estimate_id").eq("email", finishEmail).single();
    const row = rowData!;
    expect(row.outcome).toBe("call_requested");
    expect(row.converted_at).toBeTruthy();

    const staffPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await signIn(staffPage, staff!, /\/estimates/);
    await staffPage.goto("/crm/today?f=followups");
    await expect(staffPage.getByText("Call E2E Journey — confirm price")).toBeVisible();
    await staffPage.goto("/estimates");
    await expect(staffPage.getByTestId(`wizard-pill-${row.id}`)).toContainText("Ready · call");
  });
});
