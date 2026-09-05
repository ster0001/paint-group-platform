import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared fixtures for the customer-portal suites (3a-2+). */

export async function assertNoPasswordField(page: Page) {
  expect(await page.locator("input[type=password]").count(), "no password field may ever appear").toBe(0);
}

/** Mint OUR magic-link URL for an email, exactly as lib/portal/auth does —
 * the e2e stands in for the inbox. */
export async function magicLinkFor(sb: SupabaseClient, email: string): Promise<string> {
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

export async function deleteUserByEmail(sb: SupabaseClient, email: string) {
  const wanted = email.toLowerCase();
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const { data } = await sb.auth.admin.listUsers({ page: pageNo, perPage: 200 });
    const user = data?.users?.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (user) {
      // supabase-js returns the error rather than throwing, and a swallowed
      // FK refusal is how 75 e2e logins piled up on the test project (5 Sep).
      // Say so in the log; the spec's own result is not the place for it.
      const { error } = await sb.auth.admin.deleteUser(user.id);
      if (error) console.warn(`deleteUserByEmail(${email}): ${error.message}`);
      return;
    }
    if (!data?.users || data.users.length < 200) return;
  }
}

/** Tear down everything hanging off an account by its email — invoices and
 * payments before estimates (RESTRICT), then properties, memberships, the
 * account, and any wizard-anonymous users its estimates created. */
export async function destroyAccountChain(sb: SupabaseClient, email: string) {
  const { data: acct } = await sb.from("accounts").select("id").eq("email", email.toLowerCase()).maybeSingle();
  if (!acct) return;
  const accountId = (acct as { id: string }).id;
  const { data: ests } = await sb.from("estimates").select("id").eq("account_id", accountId);
  const estIds = (ests ?? []).map((e) => (e as { id: string }).id);
  if (estIds.length) {
    const { data: invs } = await sb.from("invoices").select("id").in("estimate_id", estIds);
    const invIds = (invs ?? []).map((i) => (i as { id: string }).id);
    if (invIds.length) await sb.from("payments").delete().in("invoice_id", invIds);
    await sb.from("invoices").delete().in("estimate_id", estIds);
    const { data: leads } = await sb.from("wizard_leads").select("id, user_id").in("estimate_id", estIds);
    await sb.from("wizard_leads").delete().in("estimate_id", estIds);
    const gone = await sb.from("estimates").delete().in("id", estIds);
    // Before migration 20270105 this failed for any estimate with a CRM event
    // (the append-only trigger refused the FK's "set null") — silently.
    if (gone.error) console.warn(`destroyAccountChain(${email}) estimates: ${gone.error.message}`);
    for (const lead of (leads ?? []) as Array<{ user_id: string | null }>) {
      if (lead.user_id) await sb.auth.admin.deleteUser(lead.user_id).catch(() => undefined);
    }
  }
  await sb.from("properties").delete().eq("account_id", accountId);
  await sb.from("account_users").delete().eq("account_id", accountId);
  // 3a-5: warranty_issues.account_id is RESTRICT — clear them or the account
  // delete fails silently and the fixture leaks.
  await sb.from("warranty_issues").delete().eq("account_id", accountId);
  const acct2 = await sb.from("accounts").delete().eq("id", accountId);
  if (acct2.error) console.warn(`destroyAccountChain(${email}) account: ${acct2.error.message}`);
}
