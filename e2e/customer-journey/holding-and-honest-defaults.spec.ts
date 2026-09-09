import { test, expect, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard, uniquePhone , openQuickLook, fillQuickAddress, quickNext, MONEY_RANGE } from "./drive";
import { DEFAULT_ONLINE_ESTIMATES } from "../../lib/wizard/publicFlag";

/**
 * Phase 0 of the 6 Sep estimator plan, as an anonymous customer on a phone.
 *
 *  1. While online estimates are OFF, the homepage hand-off lands on the
 *     holding page — which is a LEAD, not a closed door: the office's own
 *     wording, the typed address, and a "call me" form that files a
 *     callback_requested event on the account it creates.
 *  2. While ON, the two safety answers (built before 1970,
 *     asbestos) are unanswered until tapped — Continue refuses and names
 *     the question; the kicker counts all six steps; the confirm loop's
 *     header counts rooms and checks separately; the sweep never mentions
 *     a floorplan on a job that has none.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = !url || !serviceKey;

test.describe("holding page + honest defaults", () => {
  test.skip(missing, "needs the test project's service key (see .env.test.local)");
  const db = missing ? null : createClient(url!, serviceKey!);
  const stamp = Date.now();
  const holdEmail = `e2e-holding-${stamp}@example.com`;
  let savedFlag: unknown = null;

  test.beforeAll(async () => {
    const { data } = await db!.from("settings").select("value").eq("key", "wizard_public").maybeSingle();
    savedFlag = data?.value ?? null;
  });
  test.afterAll(async () => {
    if (!db) return;
    await db.from("settings").upsert({ key: "wizard_public", value: savedFlag ?? { enabled: true } }, { onConflict: "key" });
    const { data: acct } = await db.from("accounts").select("id").eq("email", holdEmail).maybeSingle();
    if (acct) {
      await db.from("crm_events").delete().eq("account_id", acct.id);
      await db.from("accounts").delete().eq("id", acct.id);
    }
  });

  test("OFF: the holding page carries the office wording, the typed address and a call-me form that lands on the account", async ({ browser }) => {
    await db!.from("settings").upsert({
      key: "wizard_public",
      value: { enabled: false, holdingTitle: "Opening on 28 September", holdingBody: "Leave your details and Sam will call you." },
    }, { onConflict: "key" });
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    const address = "9 Holding Court, Malvern VIC 3144";
    await page.goto(`/estimate?address=${encodeURIComponent(address)}&mode=home&src=homepage_hero`);
    await expect(page.getByTestId("holding-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opening on 28 September" })).toBeVisible();
    await expect(page.getByText("Leave your details and Sam will call you.")).toBeVisible();
    await expect(page.getByText(`For ${address}`)).toBeVisible();

    await page.getByPlaceholder("Your name").fill("Holding Tester");
    const holdPhone = uniquePhone(); // CRM v2 P1 matches accounts by phone too — one number per run
    await page.getByPlaceholder("Phone").fill(holdPhone);
    await expect(page.getByTestId("holding-send")).toBeDisabled();
    await page.getByPlaceholder("Email").fill(holdEmail);
    await page.getByTestId("holding-send").click();
    await expect(page.getByTestId("holding-sent")).toContainText("Holding");
    await expect(page.getByTestId("holding-sent")).toContainText(holdPhone);
    await ctx.close();

    const { data: acct } = await db!.from("accounts").select("id, name, phone").eq("email", holdEmail).maybeSingle();
    expect(acct, "the call-me form creates the account by email").toBeTruthy();
    expect(acct!.name).toBe("Holding Tester");
    const { data: events } = await db!.from("crm_events").select("type, payload").eq("account_id", acct!.id);
    const cb = (events ?? []).find((e) => e.type === "callback_requested");
    expect(cb, "a callback_requested event puts it on Today").toBeTruthy();
    expect(JSON.stringify(cb!.payload)).toContain("9 Holding Court");
  });

  /**
   * ⚑ REWRITTEN for v2 phase 2, and the subject genuinely changed.
   *
   * This used to assert that the asbestos and living-there questions were
   * unanswered until tapped and GATED Continue. The quick look does not ask
   * the hazard questions at all — eight questions, none of them about
   * asbestos — so the honest-defaults rule moved rather than went away:
   *
   *   the four hazard answers default to "unsure", NEVER to "no"
   *   the range still shows (an unasked question is not a dead end)
   *   and the job can never accept itself online while they are unanswered
   *
   * That last line is the one that matters. If this test ever starts finding
   * "Accept estimate" on a quick-look job, something has turned an unanswered
   * hazard question into a "no".
   */
  test("ON: the hazard questions are not asked, default to unsure, and block self-acceptance", async ({ browser }) => {
    test.setTimeout(180_000);
    await db!.from("settings").upsert({ key: "wizard_public", value: { ...DEFAULT_ONLINE_ESTIMATES, enabled: true } }, { onConflict: "key" });
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();

    await openQuickLook(page);
    // Four screens, and not one of them asks about asbestos, lead or heritage.
    for (const step of ["start", "place", "job", "condition"]) {
      if (step !== "start") await quickNext(page);
      else await fillQuickAddress(page);
      await expect(page.locator(`[data-quick-step='${step}']`)).toBeVisible();
      await expect(page.getByText(/asbestos/i)).toHaveCount(0);
      await expect(page.getByText(/built before 1970/i)).toHaveCount(0);
      await expect(page.getByText(/heritage/i)).toHaveCount(0);
    }
    await quickNext(page);

    // The range still shows — declining to guess is not declining to quote.
    await expect(page.getByTestId("reveal")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("reveal-range")).toHaveText(MONEY_RANGE);
    // And we say out loud that a person checks it.
    await page.getByTestId("reveal-assumed-toggle").click();
    await expect(page.getByTestId("reveal-assumed-hazards")).toContainText(/asbestos|lead/i);

    // The price is a range and the job cannot fix itself online.
    await page.getByTestId("door-tighten").click();
    await expect(page.locator(".sc-r").first()).toHaveText(MONEY_RANGE, { timeout: 60_000 });
    await expect(page.locator(".il-cta")).not.toHaveText(/Accept estimate/);
    await ctx.close();
  });

  test("ON: the driver still walks it, the header counts rooms and checks, and the sweep never mentions a floorplan", async ({ page }) => {
    test.setTimeout(180_000);
    await db!.from("settings").upsert({ key: "wizard_public", value: { ...DEFAULT_ONLINE_ESTIMATES, enabled: true } }, { onConflict: "key" });
    await driveNoPlanWizard(page);
    await expect(page.locator(".il-prog")).toHaveText(/0 OF \d+ ROOMS · 0 OF 2 CHECKS/);
    // Open the sweep card directly and read its wording.
    await page.locator('[data-card="sweep"] .il-hd').click();
    const sweep = page.locator('[data-card="sweep"]');
    await expect(sweep).not.toContainText(/floorplan/i);
    await expect(sweep.getByRole("button", { name: "+ WC" })).toBeVisible();
  });
});
