import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
import { assertNoPasswordField, deleteUserByEmail, destroyAccountChain, magicCodeFor, magicLinkFor, expectWizardOn, openMagicLink } from "./fixtures/portal";
import { driveNoPlanWizard } from "./customer-journey/drive";

/**
 * 3a-2 · Auth + portal shell, as the real customer.
 *
 * The headline law: a customer goes wizard → save → portal WITHOUT ever
 * seeing a registration form or a password field. Sign-in is a magic link;
 * clicking it is what joins the login to the account (3a-1 ruling); and no
 * portal state is ever a dead end.
 */

const db: SupabaseClient | null = serviceClient();

test.describe("portal auth + shell (3a-2)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal shell suite");

  const run = `${Date.now().toString(36)}${process.pid}`;
  const journeyEmail = `pg.e2e.portal.${run}@example.com`;
  const strangerEmail = `pg.e2e.stranger.${run}@example.com`;
  const scannedEmail = `pg.e2e.scanned.${run}@example.com`;
  const codeEmail = `pg.e2e.code.${run}@example.com`;

  test.afterAll(async () => {
    const sb = db!;
    for (const email of [journeyEmail, strangerEmail, scannedEmail, codeEmail]) {
      await destroyAccountChain(sb, email);
      await deleteUserByEmail(sb, email);
    }
  });

  test("wizard → save → magic link → portal, and never a registration form", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/estimate");
    await expectWizardOn(page);

    await driveNoPlanWizard(page, { email: journeyEmail });
    await assertNoPasswordField(page);

    // The save created the account and linked the estimate (3a-1).
    const sb = db!;
    const { data: acct } = await sb.from("accounts").select("id").eq("email", journeyEmail).single();
    expect(acct?.id, "the save is the account seed").toBeTruthy();
    const { data: linked } = await sb.from("estimates").select("id").eq("account_id", acct!.id);
    expect(linked?.length ?? 0).toBeGreaterThanOrEqual(1);

    // Membership does NOT exist yet — typing an email grants nothing.
    const { count: before } = await sb.from("account_users")
      .select("id", { count: "exact", head: true }).eq("account_id", acct!.id);
    expect(before ?? 0).toBe(0);

    // The emailed link (the e2e reads it straight from the mint).
    await openMagicLink(page, await magicLinkFor(sb, journeyEmail));
    await expect(page).toHaveURL(/\/account$/);
    await assertNoPasswordField(page);

    // The verified click is what joined the account.
    const { data: membership } = await sb.from("account_users")
      .select("role").eq("account_id", acct!.id);
    expect(membership?.length).toBe(1);
    expect(membership![0].role).toBe("owner");

    // State-aware Home: a saved wizard draft reads as saved, with the
    // estimate listed and one primary action.
    await expect(page.locator("h1")).toHaveText(/Your estimate is saved/);
    await expect(page.locator(".job").first()).toContainText(/Murrumbeena 3163/);
    expect(await page.locator(".btn-cyan").count()).toBe(1);

    // The shell: five tabs, and each stub names a next step (no dead ends).
    for (const label of ["My project", "My colours", "Payments", "Messages"]) {
      await page.getByRole("link", { name: label }).click();
      await expect(page.locator("h1")).not.toBeEmpty();
      await expect(page.locator(".card").last()).toContainText(/Ring us|Reply to any of our emails|Need it sooner/i);
    }
  });

  // 13 Oct 2026: Marcus (live.com.au) got "expired" on all 7 links we sent
  // him on 12 Oct — each was verified 15–30 s after delivery, by Microsoft's
  // link scanner opening it before he could. Opening the link must spend
  // nothing; only the customer's tap on the page does.
  test("a mail scanner opening the link first does not spend it", async ({ page, request }) => {
    const sb = db!;
    const link = await magicLinkFor(sb, scannedEmail);

    // The scanner: a plain GET that follows redirects, no clicks, no cookies shared.
    const scan = await request.get(link);
    expect(scan.ok()).toBeTruthy();

    // The customer, a few seconds later, on their phone.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: /Open your account/ })).toBeVisible();
    await assertNoPasswordField(page);
    await page.getByRole("button", { name: /Open my account/ }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator("h1")).toHaveText(/Welcome — let's get you a price/);
  });

  // 14 Oct 2026: the email also carries a numeric code. Typing it on the
  // "Check your email" page is the same proof of the inbox — and a scanner
  // cannot type. A wrong code stays on that page with a plain line.
  test("typing the emailed code signs in; a wrong code is a plain line, never a dead end", async ({ page }) => {
    const sb = db!;
    await page.goto(`/account/login?sent=${encodeURIComponent(codeEmail)}`);
    await expect(page.getByRole("heading", { name: /Check your email/ })).toBeVisible();
    await assertNoPasswordField(page);

    await page.getByLabel("Sign-in code").fill("000000");
    await page.getByRole("button", { name: /Sign in with the code/ }).click();
    await expect(page).toHaveURL(/error=code/);
    await expect(page.getByText(/That code didn.t match/)).toBeVisible();
    await expect(page.getByLabel("Sign-in code")).toBeVisible();

    const code = await magicCodeFor(sb, codeEmail);
    expect(code).toMatch(/^\d{6,10}$/); // OTP length is a project setting (6 or 8)
    await page.getByLabel("Sign-in code").fill(code);
    await page.getByRole("button", { name: /Sign in with the code/ }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator("h1")).toHaveText(/Welcome — let's get you a price/);

    // The verified code joined the account, exactly as the link's tap does.
    const { data: acct } = await sb.from("accounts").select("id").eq("email", codeEmail).single();
    const { data: membership } = await sb.from("account_users").select("role").eq("account_id", acct!.id);
    expect(membership?.length).toBe(1);
  });

  test("an expired or mangled link is a plain explanation, never a dead end", async ({ page }) => {
    await openMagicLink(page, "/account/auth?token_hash=not-a-real-token");
    await expect(page).toHaveURL(/\/account\/login\?error=link/);
    await expect(page.getByText(/expired or was already used/i)).toBeVisible();
    await expect(page.locator("input[type=email]")).toBeVisible();
    await assertNoPasswordField(page);
  });

  test("anonymous visitors to /account land on the passwordless login", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login/);
    await expect(page.getByRole("button", { name: /Email me a sign-in link/ })).toBeVisible();
    await assertNoPasswordField(page);
  });

  test("a stranger's login sees their own empty home, never someone else's jobs", async ({ page }) => {
    const sb = db!;
    await openMagicLink(page, await magicLinkFor(sb, strangerEmail));
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator("h1")).toHaveText(/Welcome — let's get you a price/);
    // The only .job row is the account's own Documents link — no estimates,
    // and certainly nobody else's.
    await expect(page.locator(".job")).toHaveCount(1);
    await expect(page.locator(".job")).toContainText("Your documents");
    expect(await page.getByText(/Murrumbeena/).count()).toBe(0);
  });
});
