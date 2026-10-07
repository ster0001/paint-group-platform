import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds } from "./helpers";

/**
 * Joining requires a mobile (Tom, 7 Oct 2026). Through a REAL invite: the
 * join page refuses to create the account without one, refuses a half number,
 * and with a full one the painter lands in the portal with the mobile on
 * their contractors row — where every text to them is addressed from.
 *
 * The painter this spec invites is removed at the end.
 */
const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const email = `pg.e2e.joinmobile.${Date.now().toString(36)}@example.com`;
const password = "JoinMobile-2026!";

test.afterAll(async () => {
  if (!db) return;
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const u = users?.users.find((x) => x.email === email);
  if (u) {
    await db.from("contractors").delete().eq("profile_id", u.id);
    await db.from("profiles").delete().eq("id", u.id);
    await db.auth.admin.deleteUser(u.id);
  }
  await db.from("contractor_invites").delete().eq("email", email);
});

test("an invited painter cannot join without a full mobile; with one it is on their record", async ({ page }) => {
  test.skip(!db || !staff, missingCreds("STAFF"));
  test.setTimeout(120_000);

  const token = await rpcAs(staff!, "create_contractor_invite", {
    p_email: email, p_name: "Join Mobile Tester", p_company: "Join Mobile Painting", p_tier: null, p_days: 7,
  });
  expect(token).toMatch(/^[0-9a-f]{48}$/);

  // As help-tour.spec: C1's auth rejects public sign-ups on example.com, so the
  // account exists first and the page takes its sign-in path.
  const made = await db!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Join Mobile Tester" } });
  expect(made.error?.message ?? "").toBe("");

  await page.goto(`/join/${token}`);
  await page.getByPlaceholder("Josef Kovac").fill("Join Mobile Tester");
  await page.getByPlaceholder("At least 8 characters").fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  const create = page.getByRole("button", { name: /create my account/i });

  // No mobile: refused before any account work happens.
  await create.click();
  await expect(page.locator(".err")).toContainText(/mobile is required/i);
  await expect(page).toHaveURL(/\/join\//);

  // Half a number: refused.
  await page.getByTestId("join-mobile").fill("0400 12");
  await create.click();
  await expect(page.locator(".err")).toContainText(/full Australian mobile/i);

  await page.getByTestId("join-mobile").fill("0400 123 456");
  await create.click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 30_000 });

  const { data: u } = await db!.auth.admin.listUsers({ perPage: 200 });
  const user = u?.users.find((x) => x.email === email);
  expect(user).toBeTruthy();
  const { data: c, error } = await db!.from("contractors").select("phone").eq("profile_id", user!.id).single();
  expect(error?.message ?? "").toBe("");
  expect((c as { phone: string | null }).phone).toBe("0400 123 456");
});
