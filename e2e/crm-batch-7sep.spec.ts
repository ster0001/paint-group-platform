import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, magicLinkFor } from "./fixtures/portal";

/**
 * Tom's 7 Sep CRM batch, driven on the real screens (C1):
 *
 *   · Today: the phone is on the card (tap to call) and the Log box opens
 *     where you can see it (items 14, 15)
 *   · the record: "Where they're at" card + the jump strip; the tag list has
 *     Real estate and not the three that left (items 7, 8, 9)
 *   · archiving lands back on Customers (item 10); Customers opens on the
 *     board (item 16 — the shell spec covers the toggle)
 *   · the portal: Notifications & alerts saves per type per channel, and the
 *     marketing tick moves the account's permission (item 3)
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(4).toString("hex");
const NAME = `Batch Sevensep ${run}`;
const EMAIL = `pg.e2e.batch7sep.${run}@example.com`;
const PHONE = `0491 570 ${String(parseInt(run.slice(0, 3), 16) % 1000).padStart(3, "0")}`;

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("CRM batch — 7 Sep", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const { data, error } = await sb.from("accounts")
      .insert({ email: EMAIL, name: NAME, phone: PHONE, account_type: "residential", followup_due_at: yesterday, followup_note: "ring about the deck" })
      .select("id").single();
    if (error) throw new Error(`account insert: ${error.message}`);
    accountId = (data as { id: string }).id;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    await deleteUserByEmail(sb, EMAIL);
  });

  test("Today: the phone is on the card and the Log box opens in view", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/crm/today?who=all");
    const card = page.locator(".qitem", { hasText: NAME }).first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("item-action")).toBeVisible();
    await expect(card.getByTestId("item-phone")).toHaveAttribute("href", /^tel:(\+61|0)491570/);
    await card.getByTestId("log-open").click();
    const sheet = card.getByTestId("log-sheet");
    await expect(sheet).toBeVisible();
    // Visible means INSIDE the viewport, not clipped by the card.
    const box = await sheet.boundingBox();
    const vw = page.viewportSize()?.width ?? 1280;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    await sheet.getByRole("button", { name: "Called — no answer" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet.locator(".said")).toContainText(/logged|saved/i);
  });

  test("the record: where they're at, the jump strip, and the tag list", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("status-card")).toBeVisible();
    await expect(page.getByTestId("status-stage")).not.toBeEmpty();
    await expect(page.getByTestId("jumpstrip")).toContainText("Invoices");
    await expect(page.locator("#invoices")).toBeVisible();
    await expect(page.locator("#jobs")).toBeVisible();
    const tags = page.getByTestId("tags");
    await expect(tags.getByRole("button", { name: "Real estate" })).toBeVisible();
    await expect(tags.getByRole("button", { name: "Insurance job" })).toHaveCount(0);
    await expect(tags.getByRole("button", { name: "Difficult access" })).toHaveCount(0);
    await expect(tags.getByRole("button", { name: "Sydney partner" })).toHaveCount(0);
  });

  test("the portal: Notifications & alerts saves per type per channel; marketing moves the permission", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, EMAIL));
    await page.waitForURL(/\/account/);
    // The verified login becomes the account's member (ensureMembership) — the profile links through.
    await page.goto("/account/profile");
    await page.getByTestId("notifications-link").click();
    await page.waitForURL(/\/account\/notifications/);
    await expect(page.getByTestId("notify-form")).toBeVisible();
    await page.getByLabel("Invoices & payments by text message").uncheck();
    await page.getByLabel("Property & job updates by email").uncheck();
    await page.getByTestId("notify-marketing").uncheck();
    await page.getByTestId("notify-save").click();
    await expect(page.getByTestId("notify-saved")).toBeVisible();
    // Back on the page the ticks reflect what was saved.
    await expect(page.getByLabel("Invoices & payments by text message")).not.toBeChecked();
    await expect(page.getByLabel("Invoices & payments by email")).toBeChecked();

    const { data } = await sb.from("accounts").select("notify_prefs, permit_email, permit_sms, flags").eq("id", accountId).single();
    const row = data as { notify_prefs: Record<string, Record<string, boolean>>; permit_email: string; permit_sms: string; flags: { marketing_opt_out?: boolean } };
    expect(row.notify_prefs).toEqual({ invoice: { sms: false }, job: { email: false } });
    expect(row.permit_email).toBe("declined");
    expect(row.permit_sms).toBe("declined");
    expect(row.flags.marketing_opt_out).toBe(true);
  });

  test("the CRM shows what they switched off, and archiving lands back on Customers", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("prefs-off")).toContainText("invoices & payments by text message");
    await expect(page.getByTestId("status-card")).toContainText("No marketing email");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("state-archived").click();
    await page.waitForURL(/\/crm\/customers\?archived=1/);
    await expect(page.getByTestId("flash")).toContainText("Archived");
    // Customers opened on the board (item 16).
    await expect(page.locator(".lanescroll")).toBeVisible();
  });
});
