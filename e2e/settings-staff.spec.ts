import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 5 Sep 2026 — Settings → Company → Staff logins. The master user
 * creates an office login and unticks two areas; that login's sidebar
 * drops them, its direct visits are redirected, and it cannot promote
 * itself over REST (migration 20270106's trigger). The master then removes
 * the login and it can no longer sign in.
 *
 * Tom, 24 Sep 2026: the master sets a password by hand (the login signs in
 * with it), a reset link lands on /reset-password without minting a customer
 * account, and a REMOVED login (the locked-out fallback) can be created again
 * with the same address.
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
    masterId = (await userIdFor(staff!)) ?? "";
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
    await signIn(page, staff!, /\/(home|estimates)/);
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
    await signIn(p2, { email, password }, /\/(home|estimates)/);
    const nav = p2.locator("#staff-nav");
    await expect(nav.getByRole("link", { name: "Estimates" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "CRM", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Payments" })).toHaveCount(0);
    // direct visits to a hidden area land on the first visible one
    await p2.goto("/crm");
    await expect(p2).toHaveURL(/\/(home|estimates)/, { timeout: 20_000 });
    await p2.goto("/invoicing");
    await expect(p2).toHaveURL(/\/(home|estimates)/, { timeout: 20_000 });
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

    // ---- the master sets a password by hand; the login signs in with it ----
    await page.goto("/settings#staff-logins");
    const row = page.getByTestId(`staff-row-${email}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    const password2 = "painttest456";
    await row.getByTestId(`staff-newpw-${email}`).fill(password2);
    await row.getByTestId(`staff-setpw-${email}`).click();
    await expect(page.getByTestId("staff-msg")).toContainText("Password changed", { timeout: 20_000 });
    const ctx4 = await browser.newContext();
    const p4 = await ctx4.newPage();
    await signIn(p4, { email, password: password2 }, /\/(home|estimates)/);
    await ctx4.close();

    // ---- a reset link: the click lands on /reset-password, saves, goes home;
    //      and no customer account is minted for an office address ----------
    await row.getByTestId(`staff-reset-${email}`).click();
    await expect(page.getByTestId("staff-msg")).toContainText(/Reset link emailed|isn't configured|couldn't be sent/, { timeout: 20_000 });
    const minted = await db!.auth.admin.generateLink({ type: "magiclink", email });
    expect(minted.error).toBeNull();
    const ctx5 = await browser.newContext();
    const p5 = await ctx5.newPage();
    await p5.goto(`/account/auth?token_hash=${minted.data.properties!.hashed_token}&next=/reset-password`);
    await expect(p5).toHaveURL(/\/reset-password/, { timeout: 20_000 });
    const password3 = "painttest789";
    await p5.getByTestId("reset-pw").fill(password3);
    await p5.getByTestId("reset-pw2").fill(password3);
    await p5.getByTestId("reset-submit").click();
    await expect(p5).toHaveURL(/\/(home|estimates)/, { timeout: 20_000 });
    await ctx5.close();
    const { count: accountsForStaff, error: accErr } = await db!.from("accounts").select("id", { count: "exact", head: true }).ilike("email", email);
    expect(accErr).toBeNull();
    expect(accountsForStaff ?? 0).toBe(0);
    const ctx6 = await browser.newContext();
    const p6 = await ctx6.newPage();
    await signIn(p6, { email, password: password3 }, /\/(home|estimates)/);
    await ctx6.close();

    // ---- the master removes it --------------------------------------------
    await page.goto("/settings#staff-logins");
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

    // ---- Tom, 24 Sep: "when a staff member is deleted I can't re-create them".
    // Remove's fallback (their rows refuse the delete) bans + demotes the
    // login instead, leaving the address taken. Put a login in exactly that
    // state, then create it again from the form: the same address, restored.
    await page.goto("/settings#staff-logins");
    await expect(form).toBeVisible({ timeout: 20_000 });
    await form.getByTestId("staff-email").fill(email);
    await form.getByTestId("staff-name").fill(`Office ${run}`);
    await form.getByTestId("staff-password").fill(password);
    await form.getByTestId("staff-submit").click();
    await expect(page.getByTestId("staff-msg")).toContainText("can sign in", { timeout: 20_000 });
    const againId = await userIdByEmail(db!, email);
    expect(againId).toBeTruthy();
    const ban = await db!.auth.admin.updateUserById(againId!, { ban_duration: "876000h" });
    expect(ban.error).toBeNull();
    const demote = await db!.from("profiles").update({ role: "customer", is_owner: false, staff_access: {} }).eq("id", againId!);
    expect(demote.error).toBeNull();

    // Same URL, hash only, would be a same-document navigation — reload for real.
    await page.reload();
    await expect(form).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`staff-row-${email}`)).toHaveCount(0);
    const password4 = "painttest000";
    await form.getByTestId("staff-email").fill(email);
    await form.getByTestId("staff-name").fill(`Office ${run} again`);
    await form.getByTestId("staff-password").fill(password4);
    await form.getByTestId("staff-submit").click();
    await expect(page.getByTestId("staff-msg")).toContainText(/can sign in.*restored/, { timeout: 20_000 });
    await expect(page.getByTestId(`staff-row-${email}`)).toBeVisible();
    const ctx7 = await browser.newContext();
    const p7 = await ctx7.newPage();
    await signIn(p7, { email, password: password4 }, /\/(home|estimates)/);
    await ctx7.close();
    // The same auth id came back — anything filed under it before is still theirs.
    expect(await userIdByEmail(db!, email)).toBe(againId);
  });
});
