import { test, expect, devices } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { driveNoPlanWizard } from "./drive";
import { DEFAULT_ONLINE_ESTIMATES } from "../../lib/wizard/publicFlag";

/**
 * Phase 0 of the 6 Sep estimator plan, as an anonymous customer on a phone.
 *
 *  1. While online estimates are OFF, the homepage hand-off lands on the
 *     holding page — which is a LEAD, not a closed door: the office's own
 *     wording, the typed address, and a "call me" form that files a
 *     callback_requested event on the account it creates.
 *  2. While ON, the three safety answers (heritage, built before 1970,
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
    await page.getByPlaceholder("Phone").fill("0400 000 222");
    await expect(page.getByTestId("holding-send")).toBeDisabled();
    await page.getByPlaceholder("Email").fill(holdEmail);
    await page.getByTestId("holding-send").click();
    await expect(page.getByTestId("holding-sent")).toContainText("Holding");
    await expect(page.getByTestId("holding-sent")).toContainText("0400 000 222");
    await ctx.close();

    const { data: acct } = await db!.from("accounts").select("id, name, phone").eq("email", holdEmail).maybeSingle();
    expect(acct, "the call-me form creates the account by email").toBeTruthy();
    expect(acct!.name).toBe("Holding Tester");
    const { data: events } = await db!.from("crm_events").select("type, payload").eq("account_id", acct!.id);
    const cb = (events ?? []).find((e) => e.type === "callback_requested");
    expect(cb, "a callback_requested event puts it on Today").toBeTruthy();
    expect(JSON.stringify(cb!.payload)).toContain("9 Holding Court");
  });

  test("ON: safety answers are unanswered until tapped; six honest steps; rooms and checks counted apart", async ({ browser }) => {
    test.setTimeout(180_000);
    await db!.from("settings").upsert({ key: "wizard_public", value: { ...DEFAULT_ONLINE_ESTIMATES, enabled: true } }, { onConflict: "key" });
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await page.goto("/estimate");
    await expect(page.getByText("Step 1 of 6", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await page.getByPlaceholder("Suburb").fill("Murrumbeena");
    await page.getByPlaceholder("Postcode").fill("3163");
    // Nothing pre-selected on the safety row.
    const heritageRow = page.locator(".wz-qhead", { hasText: "Heritage listed" }).locator("xpath=following-sibling::div[1]");
    await expect(heritageRow.locator("button.on")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator(".wz-err")).toContainText(/Heritage listed/);
    await heritageRow.getByRole("button", { name: "No", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 2 of 6", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click(); // → condition
    await page.getByRole("button", { name: "Continue" }).click(); // → details
    await expect(page.getByText("Step 4 of 6", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator(".wz-err")).toContainText(/built before 1970/);
    const preRow = page.locator(".wz-qhead", { hasText: /built before 1970/ }).locator("xpath=following-sibling::div[1]");
    await preRow.getByRole("button", { name: "No", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator(".wz-err")).toContainText(/asbestos/i);
    const asbRow = page.locator(".wz-qhead", { hasText: /asbestos/ }).locator("xpath=following-sibling::div[1]");
    await asbRow.getByRole("button", { name: "No", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Step 5 of 6", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Nearly there" }).click();
    await expect(page.getByText("Step 6 of 6", { exact: false })).toBeVisible();
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
