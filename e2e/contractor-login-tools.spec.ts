import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 24 Sep 2026 — "allow to manually update passwords and send reset links
 * for contractors". On a painter's page the office sets a password by hand
 * (the painter signs in with it), and emails a reset link whose click lands
 * on /reset-password, where the painter chooses their own — without a
 * customer account being minted for a painter's address.
 *
 * A throwaway painter, so no shared login's password moves; deleted after.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const run = Date.now().toString(36);
const EMAIL = `pg.e2e.pwpainter.${run}@example.com`;
const NAME = `E2E Password Painter ${run}`;
let userId = "";
let contractorId = "";

test.describe("a painter's login: password by hand, reset link", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to provision the throwaway painter");
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeAll(async () => {
    const created = await db!.auth.admin.createUser({ email: EMAIL, password: `First-${run}-pw!`, email_confirm: true, user_metadata: { name: NAME } });
    if (created.error || !created.data.user) throw new Error(`create painter: ${created.error?.message}`);
    userId = created.data.user.id;
    const prof = await db!.from("profiles").update({ role: "contractor", name: NAME }).eq("id", userId);
    if (prof.error) throw new Error(prof.error.message);
    const c = await db!.from("contractors").insert({ profile_id: userId, tier: "C", active: true, company_name: `Password Co ${run}`, crew_size: 1 }).select("id").single();
    if (c.error) throw new Error(c.error.message);
    contractorId = (c.data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.from("messages").delete().eq("to_address", EMAIL);
    if (contractorId) await db.from("contractors").delete().eq("id", contractorId);
    if (userId) {
      const r = await db.auth.admin.deleteUser(userId);
      if (r.error) throw new Error(`teardown user: ${r.error.message}`);
    }
  });

  test("set a password by hand, then a reset link that lands on /reset-password", async ({ page, browser }) => {
    test.setTimeout(150_000);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/contractors/${contractorId}`);
    const card = page.getByTestId("card-login");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(EMAIL);

    // Too short: the button stays off.
    await card.getByTestId("login-newpw").fill("short");
    await expect(card.getByTestId("login-setpw")).toBeDisabled();

    const password = `Painter-${run}-pw!`;
    await card.getByTestId("login-newpw").fill(password);
    await card.getByTestId("login-setpw").click();
    await expect(card.getByTestId("login-msg")).toContainText("Password changed", { timeout: 20_000 });

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await signIn(p2, { email: EMAIL, password }, /\/portal/);
    await ctx2.close();

    // The reset link: recorded as a message whatever this server's email key says.
    await card.getByTestId("login-reset").click();
    await expect(card.getByTestId("login-msg")).toContainText(/Reset link emailed|isn't configured|couldn't be sent/, { timeout: 20_000 });
    const { data: msg, error: msgErr } = await db!.from("messages").select("subject").eq("to_address", EMAIL).order("created_at", { ascending: false }).limit(1).maybeSingle();
    expect(msgErr).toBeNull();
    if (msg) expect(String((msg as { subject: string | null }).subject ?? "")).toMatch(/Reset your password/);

    // The click: /account/auth → /reset-password → save → the portal. No
    // customer account for a painter's address.
    const minted = await db!.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
    expect(minted.error).toBeNull();
    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await p3.goto(`/account/auth?token_hash=${minted.data.properties!.hashed_token}&next=/reset-password`);
    await expect(p3).toHaveURL(/\/reset-password/, { timeout: 20_000 });
    await expect(p3.getByText(EMAIL)).toBeVisible();
    const password2 = `Painter-${run}-two!`;
    await p3.getByTestId("reset-pw").fill(password2);
    await p3.getByTestId("reset-pw2").fill("different");
    await p3.getByTestId("reset-submit").click();
    await expect(p3.getByTestId("reset-msg")).toContainText("don't match");
    await p3.getByTestId("reset-pw2").fill(password2);
    await p3.getByTestId("reset-submit").click();
    await expect(p3).toHaveURL(/\/portal/, { timeout: 20_000 });
    await ctx3.close();
    const { count, error: accErr } = await db!.from("accounts").select("id", { count: "exact", head: true }).ilike("email", EMAIL);
    expect(accErr).toBeNull();
    expect(count ?? 0).toBe(0);

    const ctx4 = await browser.newContext();
    const p4 = await ctx4.newPage();
    await signIn(p4, { email: EMAIL, password: password2 }, /\/portal/);
    await ctx4.close();
  });
});
