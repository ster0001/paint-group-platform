import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom's 8 Sep batch — the chrome and the record:
 *   · the logo top-left is on the CRM, Projects and Payments, and goes home
 *   · dark / light is one choice across all three (the CRM's cookie)
 *   · the record head carries the contact address beside phone and email
 *   · a dropped-out online estimate shows on the record as a strip, with the
 *     page they stopped on and when they were last active
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(4).toString("hex");
const SHOTS = process.env.E2E_SHOTS ?? "";

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

test.describe("8 Sep — chrome, theme, record address, wizard strip", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "", wizId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts").insert({ email: `pg.e2e.chrome.${run}@example.com`, name: `Ada Address ${run}`, phone: "0491 570 157", account_type: "residential" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id as string;
    const prop = await sb.from("properties").insert({ account_id: accountId, address: "7 Wattle Court", suburb: "Thornbury", state: "VIC", postcode: "3071", address_norm: `7 wattle court thornbury 3071 ${run}` }).select("id").single();
    if (prop.error) throw new Error(prop.error.message);
    const lastSeen = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const wiz = await sb.from("wizard_drafts").insert({
      account_id: accountId, address: "7 Wattle Court", suburb: "Thornbury", job_type: "interior", mode: "home", entry_source: "homepage_hero",
      bucket: "dropped", furthest_page: 3, current_page: 3, pages_total: 6, active_seconds: 245,
      started_at: new Date(Date.now() - 4 * 3_600_000).toISOString(), last_seen_at: lastSeen, dropped_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    }).select("id").single();
    if (wiz.error) throw new Error(wiz.error.message);
    wizId = wiz.data.id as string;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (wizId) await sb.from("wizard_drafts").delete().eq("id", wizId);
    if (accountId) {
      await sb.from("crm_events").delete().eq("account_id", accountId).then(() => undefined, () => undefined);
      await sb.from("properties").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
  });

  test("the logo goes home from every dark-chrome surface, and one theme follows all three", async ({ page }) => {
    // Three dark-chrome shells compile on first visit in dev (15 s each).
    test.setTimeout(240_000);
    await loginAs(page, staff);
    await page.goto("/crm/today");
    const crm = page.locator(".crm");
    await expect(crm).toHaveAttribute("data-theme", "dark");
    const home = page.getByTestId("home-mark");
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute("href", /^\/(estimates|proving|pc|invoices|invoicing|contacts|crm|contractors|settings)$/);
    await shot(page, "crm-dark");
    await page.getByTestId("theme-toggle").click();
    await expect(crm).toHaveAttribute("data-theme", "light");
    await shot(page, "crm-light");

    await page.goto("/pc");
    await expect(page.locator(".pc")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("home-mark")).toBeVisible();
    expect(await page.locator(".pc").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(18, 22, 26)");
    await shot(page, "pc-light");

    await page.goto("/invoicing");
    await expect(page.locator(".invx")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("home-mark")).toBeVisible();
    expect(await page.locator(".invx").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(241, 244, 246)");
    await shot(page, "invoicing-light");
    // Flip back from Payments; the CRM follows.
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator(".invx")).toHaveAttribute("data-theme", "dark");
    await shot(page, "invoicing-dark");
    await page.goto("/pc");
    await expect(page.locator(".pc")).toHaveAttribute("data-theme", "dark");
    await shot(page, "pc-dark");
    await page.goto("/crm/today");
    await expect(page.locator(".crm")).toHaveAttribute("data-theme", "dark");

    // The logo really leaves the CRM for the main platform.
    await page.getByTestId("home-mark").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/crm"), { waitUntil: "commit" });
    expect(new URL(page.url()).pathname.startsWith("/crm")).toBe(false);
  });

  test("the record head shows the contact address, and the dropped-out online estimate as a strip", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    const addr = page.getByTestId("record-address");
    await expect(addr).toContainText("7 Wattle Court Thornbury VIC 3071");
    await expect(addr.locator("a").first()).toHaveAttribute("href", /maps\.google\.com/);
    const strip = page.getByTestId("wizard-strip");
    await expect(strip).toContainText("Dropped · Condition");
    await expect(strip).toContainText("3 of 6");
    await expect(strip).toContainText("4 min");
    await expect(strip).toContainText("last active 3h ago");
    await expect(strip).toContainText(/left \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [ap]m/);
    await expect(strip.getByRole("link", { name: /Open the session/ })).toHaveAttribute("href", `/estimates?status=wizard&open=${wizId}`);
    await shot(page, "record-address-strip");
  });
});
