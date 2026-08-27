import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain } from "./fixtures/portal";

/**
 * 3a close-out · the staff path joins the account chain by itself: a staff
 * save whose builder_state carries a contact email links the estimate to
 * that customer's account through the same one identity rule the wizard
 * uses — no backfill re-runs. Driven AS STAFF against the real screen.
 */

const db: SupabaseClient | null = serviceClient();
const staff = {
  email: process.env.E2E_STAFF_EMAIL ?? "",
  password: process.env.E2E_STAFF_PASSWORD ?? "",
};

test.describe("builder account link (3a)", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const run = randomBytes(4).toString("hex");
  const customerEmail = `builder.link.${run}@volume.example`;
  let estimateId = "";

  test.afterAll(async () => {
    const sb = db!;
    if (estimateId) await sb.from("estimates").delete().eq("id", estimateId);
    await destroyAccountChain(sb, customerEmail);
    await deleteUserByEmail(sb, customerEmail);
  });

  test("a staff save with a contact email links the estimate to the account", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', staff.email);
    await page.fill('input[type="password"]', staff.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/estimates/);

    // A fresh estimate in the real builder.
    await page.goto("/quote");
    await page.waitForLoadState("networkidle");

    // The Contact card → modal → email → "Use on estimate".
    await page.getByRole("button", { name: /add contact/i }).first().click();
    await page.locator("label", { hasText: "First name" }).locator("input").fill("Linked");
    await page.locator("label", { hasText: "Email" }).locator("input").fill(customerEmail);
    await page.getByRole("button", { name: "Use on estimate" }).click();

    // Save the estimate itself.
    await page.getByRole("button", { name: /^save/i }).first().click();
    await expect(page.getByText("Saved ✓")).toBeVisible({ timeout: 20_000 });

    // The fire-and-forget link lands within a few seconds.
    const sb = db!;
    await expect
      .poll(async () => {
        const { data: acct } = await sb.from("accounts").select("id").eq("email", customerEmail).maybeSingle();
        if (!acct) return "no-account";
        const { data: est } = await sb.from("estimates")
          .select("id").eq("account_id", (acct as { id: string }).id).limit(1).maybeSingle();
        estimateId = (est as { id: string } | null)?.id ?? "";
        return est ? "linked" : "account-only";
      }, { timeout: 20_000 })
      .toBe("linked");
  });
});
