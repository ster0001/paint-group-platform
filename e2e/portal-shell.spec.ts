import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./fixtures/woLoop";
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

async function assertNoPasswordField(page: Page) {
  expect(await page.locator("input[type=password]").count(), "no password field may ever appear").toBe(0);
}

/** Mint OUR magic-link URL for an email, exactly as lib/portal/auth does —
 * the e2e stands in for the inbox. */
async function magicLinkFor(sb: SupabaseClient, email: string): Promise<string> {
  let link = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    const created = await sb.auth.admin.createUser({ email });
    if (created.error && !/already/i.test(created.error.message)) throw new Error(created.error.message);
    link = await sb.auth.admin.generateLink({ type: "magiclink", email });
  }
  if (link.error || !link.data?.properties?.hashed_token) {
    throw new Error(`generateLink: ${link.error?.message ?? "no token"}`);
  }
  return `/account/auth?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}`;
}

async function deleteUserByEmail(sb: SupabaseClient, email: string) {
  const wanted = email.toLowerCase();
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const { data } = await sb.auth.admin.listUsers({ page: pageNo, perPage: 200 });
    const user = data?.users?.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (user) {
      await sb.auth.admin.deleteUser(user.id);
      return;
    }
    if (!data?.users || data.users.length < 200) return;
  }
}

async function destroyAccountChain(sb: SupabaseClient, email: string) {
  const { data: acct } = await sb.from("accounts").select("id").eq("email", email.toLowerCase()).maybeSingle();
  if (!acct) return;
  const accountId = (acct as { id: string }).id;
  const { data: ests } = await sb.from("estimates").select("id").eq("account_id", accountId);
  const estIds = (ests ?? []).map((e) => (e as { id: string }).id);
  if (estIds.length) {
    await sb.from("invoices").delete().in("estimate_id", estIds);
    const { data: leads } = await sb.from("wizard_leads").select("id, user_id").in("estimate_id", estIds);
    await sb.from("wizard_leads").delete().in("estimate_id", estIds);
    await sb.from("estimates").delete().in("id", estIds);
    for (const lead of (leads ?? []) as Array<{ user_id: string | null }>) {
      if (lead.user_id) await sb.auth.admin.deleteUser(lead.user_id).catch(() => undefined);
    }
  }
  await sb.from("properties").delete().eq("account_id", accountId);
  await sb.from("account_users").delete().eq("account_id", accountId);
  await sb.from("accounts").delete().eq("id", accountId);
}

test.describe("portal auth + shell (3a-2)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal shell suite");

  const run = `${Date.now().toString(36)}${process.pid}`;
  const journeyEmail = `pg.e2e.portal.${run}@example.com`;
  const strangerEmail = `pg.e2e.stranger.${run}@example.com`;

  test.afterAll(async () => {
    const sb = db!;
    for (const email of [journeyEmail, strangerEmail]) {
      await destroyAccountChain(sb, email);
      await deleteUserByEmail(sb, email);
    }
  });

  test("wizard → save → magic link → portal, and never a registration form", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/estimate");
    if (await page.getByText(/nearly here/i).count()) {
      test.skip(true, "wizard_public is off in this environment");
    }

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
    await page.goto(await magicLinkFor(sb, journeyEmail));
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
    for (const label of ["My project", "My colours", "Money", "Messages"]) {
      await page.getByRole("link", { name: label }).click();
      await expect(page.locator("h1")).not.toBeEmpty();
      await expect(page.locator(".card").last()).toContainText(/Ring us|Reply to any of our emails|Need it sooner/i);
    }
  });

  test("an expired or mangled link is a plain explanation, never a dead end", async ({ page }) => {
    await page.goto("/account/auth?token_hash=not-a-real-token");
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
    await page.goto(await magicLinkFor(sb, strangerEmail));
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator("h1")).toHaveText(/Welcome — let's get you a price/);
    await expect(page.locator(".job")).toHaveCount(0);
  });
});
