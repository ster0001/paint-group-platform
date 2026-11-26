import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { uniquePhone } from "../customer-journey/drive";

/**
 * The website chat asks for contact details and counts them once (Tom, 26 Nov
 * 2026), as an ANONYMOUS visitor on the HOMEPAGES:
 *  1. the chat bubble is on the Paint Home and the Paint Group homepage
 *  2. Paint Home: a question → the chat asks for name, email and mobile (in
 *     hours while a person picks it up, out of hours in the closed reply);
 *     the form's details → a thank-you, the form goes, ONE pg_success / lead
 *     (the hidden /thanks/lead frame); another line never counts again
 *  3. details typed into a message are a capture too — one lead, no form
 * Test-pattern emails never reach an account (isTestEmail), so the clean-up
 * finds the accounts by phone.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
const stamp = Date.now();
const phones = [uniquePhone(), `04${String(stamp + 7).slice(-8)}`];

async function prepare(page: Page, root: string) {
  await page.context().addCookies([{ name: "pg_consent", value: "analytics", url: root }]);
  await page.route("https://www.googletagmanager.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
}
async function openChat(page: Page) {
  await page.getByTestId("wz-chat-bubble").click();
  await expect(page.getByTestId("wz-chat-assistant").first()).toBeVisible({ timeout: 30_000 });
}
async function say(page: Page, line: string) {
  const before = await page.getByTestId("wz-chat-assistant").count();
  await page.getByTestId("wz-chat-text").fill(line);
  await page.getByTestId("wz-chat-send").click();
  await expect.poll(() => page.getByTestId("wz-chat-assistant").count(), { timeout: 20_000 }).toBeGreaterThan(before);
}

test.describe("Website chat — contact details are a lead", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY for the clean-up");
  let phRoot = "";
  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
  });
  test.afterAll(async () => {
    if (!db) return;
    for (const p of phones) {
      const { data, error } = await db.rpc("crm_find_account", { p_email: null, p_phone: p });
      if (error) throw new Error(`clean-up lookup: ${error.message}`);
      const id = (data as string | null) ?? null;
      if (!id) continue;
      await db.from("agent_conversations").delete().eq("account_id", id);
      await db.from("crm_events").delete().eq("account_id", id);
      await db.from("accounts").delete().eq("id", id);
    }
  });

  test("1 · the chat is on both homepages", async ({ page }) => {
    await page.goto(`${phRoot}/`);
    await expect(page.getByTestId("wz-chat-bubble")).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("wz-chat-bubble")).toBeVisible();
  });

  test("2 · a question → the ask → the form → one lead", async ({ page }) => {
    test.setTimeout(90_000);
    await prepare(page, phRoot);
    await page.goto(`${phRoot}/`);
    await openChat(page);
    await expect(page.getByTestId("wz-chat-contact")).toHaveCount(0);
    await say(page, "How long does a three bedroom house take?");
    await expect(page.getByTestId("wz-chat-log")).toContainText("name, email and mobile");
    await expect(page.getByTestId("wz-chat-contact")).toBeVisible();
    const leads = page.locator('iframe[data-testid="thanks-bg-lead"]');
    await expect(leads).toHaveCount(0);

    await page.getByTestId("wz-chat-contact-name").fill("Robin Chat");
    await page.getByTestId("wz-chat-contact-email").fill(`e2e-chatlead-${stamp}@example.com`);
    await page.getByTestId("wz-chat-contact-phone").fill(phones[0]);
    await page.getByTestId("wz-chat-contact-send").click();
    await expect(page.getByTestId("wz-chat-log")).toContainText("Thanks Robin — we've got your details", { timeout: 20_000 });
    await expect(page.getByTestId("wz-chat-contact")).toHaveCount(0);
    await expect(leads).toHaveCount(1);
    await expect(leads).toHaveAttribute("src", "/thanks/lead?bg=1");

    await say(page, `Also my number again is ${phones[0]}`);
    await page.waitForTimeout(500);
    await expect(page.locator('iframe[data-testid^="thanks-bg-"]')).toHaveCount(1);
    await expect(page.getByTestId("wz-chat-contact")).toHaveCount(0);
  });

  test("3 · details typed into a message are a capture — one lead, no form", async ({ page }) => {
    test.setTimeout(90_000);
    await prepare(page, phRoot);
    await page.goto(`${phRoot}/`);
    await openChat(page);
    await say(page, `Hi, can someone call me? e2e-chattyped-${stamp}@example.com ${phones[1]}`);
    await expect(page.getByTestId("wz-chat-log")).toContainText("we've got your details", { timeout: 20_000 });
    await expect(page.getByTestId("wz-chat-contact")).toHaveCount(0);
    await expect(page.locator('iframe[data-testid="thanks-bg-lead"]')).toHaveCount(1);
  });
});
