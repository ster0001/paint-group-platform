import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 5 Sep 2026 — Settings → Company → Staff logins. The master user
 * creates an office login and unticks two areas; that login's sidebar
 * drops them, its direct visits are redirected, and it cannot promote
 * itself over REST (migration 20270106's trigger). The master then removes
 * the login and it can no longer sign in.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function userIdByEmail(sb: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const u = data?.users?.find((x) => (x.email ?? "").toLowerCase() === wanted);
    if (u) return u.id;
    if (!data?.users || data.users.length < 200) return null;
  }
  return null;
}

test.describe("Settings → Staff logins", () => {
  test.skip(!staff || !db || !url || !anonKey, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });

  const run = randomBytes(3).toString("hex");
  const email = `pg.e2e.staff.${run}@example.com`;
  const password = "painttest123";
  let masterId = "";
  let masterWasOwner = false;

  test.beforeAll(async () => {
    // The e2e staff login plays the master for this spec; put it back after.
    masterId = (await userIdByEmail(db!, staff!.email)) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    masterWasOwner = data?.is_owner === true;
    if (!masterWasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);
  });
  test.afterAll(async () => {
    if (!db) return;
    const id = await userIdByEmail(db, email);
    if (id) await db.auth.admin.deleteUser(id);
    if (!masterWasOwner) await db.from("profiles").update({ is_owner: false }).eq("id", masterId);
  });

  test("the master creates a login that sees only some areas; the rest is out of reach; then removes it", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/settings#staff-logins");
    const form = page.getByTestId("staff-create");
    await expect(form).toBeVisible({ timeout: 20_000 });
    await form.getByTestId("staff-email").fill(email);
    await form.getByTestId("staff-name").fill(`Office ${run}`);
    await form.getByTestId("staff-password").fill(password);
    await form.getByTestId("area-crm").uncheck();
    await form.getByTestId("area-payments").uncheck();
    await form.getByTestId("staff-submit").click();
    await expect(page.getByTestId("staff-msg")).toContainText("can sign in", { timeout: 20_000 });
    await expect(page.getByTestId(`staff-row-${email}`)).toBeVisible();

    // ---- the new login, in its own browser ------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx.newPage();
    await signIn(p2, { email, password }, /\/estimates/);
    const nav = p2.locator("#staff-nav");
    await expect(nav.getByRole("link", { name: "Estimates" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "CRM", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Payments" })).toHaveCount(0);
    // direct visits to a hidden area land on the first visible one
    await p2.goto("/crm");
    await expect(p2).toHaveURL(/\/estimates/, { timeout: 20_000 });
    await p2.goto("/invoicing");
    await expect(p2).toHaveURL(/\/estimates/, { timeout: 20_000 });
    await p2.goto("/contacts");
    await expect(p2).toHaveURL(/\/contacts/, { timeout: 20_000 });

    // ---- it cannot make itself master over REST ------------------------
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anonKey!, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
    const myId = auth.user?.id as string;
    const patch = await fetch(`${url}/rest/v1/profiles?id=eq.${myId}`, {
      method: "PATCH",
      headers: { apikey: anonKey!, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ is_owner: true }),
    });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const { data: still } = await db!.from("profiles").select("is_owner, staff_access").eq("id", myId).single();
    expect(still?.is_owner).toBe(false);
    expect(still?.staff_access).toEqual({ crm: false, payments: false });
    await ctx.close();

    // ---- the master removes it --------------------------------------------
    await page.goto("/settings#staff-logins");
    const row = page.getByTestId(`staff-row-${email}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Remove login" }).click();
    await expect(page.getByTestId("staff-msg")).toContainText(/removed|locked out/, { timeout: 20_000 });
    await expect(page.getByTestId(`staff-row-${email}`)).toHaveCount(0);

    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await p3.goto("/login");
    await p3.getByLabel("Email").fill(email);
    await p3.getByLabel("Password").fill(password);
    await p3.getByRole("button", { name: "Sign in" }).click();
    await p3.waitForTimeout(3000);
    await expect(p3).toHaveURL(/\/login/);
    await ctx3.close();
  });
});
