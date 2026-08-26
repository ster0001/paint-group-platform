import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * 3a-1 · The account chain under RLS, proven through each role's OWN session
 * (never the service key — the CLAUDE.md lesson).
 *
 * What must hold:
 *  - a member reads exactly their own account, membership and properties;
 *  - another customer's chain returns zero rows, not an error;
 *  - a customer can neither create nor edit accounts;
 *  - estimates and invoices stay UNREADABLE to customers even for their own
 *    account (builder_state carries margins — customers get rendered views);
 *  - an invoice inserted with only estimate_id inherits the estimate's
 *    account (the structural S2 fix).
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Session = { token: string };

async function signIn(email: string, password: string): Promise<Session> {
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey!, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!auth.access_token) throw new Error(`sign-in failed for ${email}: ${auth.msg ?? auth.error_description}`);
  return { token: auth.access_token };
}

async function restGet(session: Session | null, path: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: anonKey!,
      Authorization: `Bearer ${session ? session.token : anonKey}`,
    },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function restWrite(
  session: Session,
  method: "POST" | "PATCH",
  path: string,
  payload: unknown,
): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey!,
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test.describe("account chain RLS (3a-1)", () => {
  test.skip(!db || !url || !anonKey, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const password = "painttest123";
  const userA = { email: `pg.e2e.acct.a.${run}@example.com`, id: "" };
  const userB = { email: `pg.e2e.acct.b.${run}@example.com`, id: "" };
  let accountA = "";
  let accountB = "";
  let propertyA = "";
  let estimateA = "";
  let invoiceA = "";
  let migrationReady = true;

  test.beforeAll(async () => {
    const sb = db!;
    // Probe first: before migration 20261128 the tables don't exist — every
    // test skips with the migration named rather than failing noisily.
    const probe = await sb.from("accounts").select("id").limit(1);
    if (probe.error) {
      migrationReady = false;
      return;
    }

    for (const u of [userA, userB]) {
      const created = await sb.auth.admin.createUser({
        email: u.email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
      u.id = created.data.user.id;
    }

    const acctA = await sb.from("accounts").insert({ email: userA.email, name: "Acct A e2e" }).select("id").single();
    const acctB = await sb.from("accounts").insert({ email: userB.email, name: "Acct B e2e" }).select("id").single();
    if (acctA.error || acctB.error) throw new Error(`account fixtures: ${acctA.error?.message ?? acctB.error?.message}`);
    accountA = acctA.data.id;
    accountB = acctB.data.id;

    const link = await sb.from("account_users").insert({ account_id: accountA, profile_id: userA.id, role: "owner" });
    if (link.error) throw new Error(`membership fixture: ${link.error.message}`);

    const propA = await sb.from("properties").insert({
      account_id: accountA, address: "12 Acacia Street", suburb: "Northcote", postcode: "3070",
      address_norm: `12 acacia street northcote 3070 ${run}`,
    }).select("id").single();
    const propB = await sb.from("properties").insert({
      account_id: accountB, address: "4 Elm Grove", suburb: "Preston", postcode: "3072",
      address_norm: `4 elm grove preston 3072 ${run}`,
    }).select("id").single();
    if (propA.error || propB.error) throw new Error(`property fixtures: ${propA.error?.message ?? propB.error?.message}`);
    propertyA = propA.data.id;

    const est = await sb.from("estimates").insert({
      title: `3a-1 RLS e2e ${run}`, status: "draft",
      account_id: accountA, property_id: propertyA,
      builder_state: { blocks: [], marginCents: 424242 },
    }).select("id").single();
    if (est.error) throw new Error(`estimate fixture: ${est.error.message}`);
    estimateA = est.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (invoiceA) await sb.from("invoices").delete().eq("id", invoiceA);
    if (estimateA) await sb.from("estimates").delete().eq("id", estimateA);
    if (accountA) await sb.from("properties").delete().in("account_id", [accountA, accountB].filter(Boolean));
    if (accountA) await sb.from("account_users").delete().eq("account_id", accountA);
    for (const id of [accountA, accountB]) if (id) await sb.from("accounts").delete().eq("id", id);
    for (const u of [userA, userB]) if (u.id) await sb.auth.admin.deleteUser(u.id);
  });

  test("a member reads exactly their own account — and no one else's", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    const a = await signIn(userA.email, password);

    const mine = await restGet(a, "accounts?select=id,email,account_type");
    expect(mine.status).toBe(200);
    const rows = mine.body as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([accountA]);

    const theirs = await restGet(a, `accounts?id=eq.${accountB}&select=id`);
    expect(theirs.body).toEqual([]);
  });

  test("a login with no membership sees zero accounts", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    const b = await signIn(userB.email, password);
    const rows = await restGet(b, "accounts?select=id");
    expect(rows.body).toEqual([]);
  });

  test("properties follow membership — own visible, others' invisible", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    const a = await signIn(userA.email, password);
    const rows = await restGet(a, "properties?select=id,address");
    expect((rows.body as Array<{ id: string }>).map((r) => r.id)).toEqual([propertyA]);
  });

  test("a customer can neither create nor edit accounts", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    const a = await signIn(userA.email, password);

    const insert = await restWrite(a, "POST", "accounts", { email: `intruder.${run}@example.com` });
    expect(insert.status).toBeGreaterThanOrEqual(400); // RLS: no insert policy for customers

    const update = await restWrite(a, "PATCH", `accounts?id=eq.${accountA}`, { account_type: "trade" });
    // member_select is SELECT-only: the update matches no rows.
    expect(Array.isArray(update.body) ? (update.body as unknown[]).length : 0).toBe(0);
    const check = await db!.from("accounts").select("account_type").eq("id", accountA).single();
    expect(check.data?.account_type).toBe("residential");
  });

  test("estimates and invoices stay unreadable to the customer — even their own account's", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    const a = await signIn(userA.email, password);
    const est = await restGet(a, `estimates?account_id=eq.${accountA}&select=id,builder_state`);
    expect(est.body).toEqual([]); // margins live in builder_state — rendered views only
    const inv = await restGet(a, `invoices?account_id=eq.${accountA}&select=id`);
    expect(inv.body).toEqual([]);
  });

  test("anonymous key alone reads nothing from the chain", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    for (const path of ["accounts?select=id", "account_users?select=id", "properties?select=id"]) {
      const r = await restGet(null, path);
      expect([200, 401, 403]).toContain(r.status);
      if (r.status === 200) expect(r.body).toEqual([]);
    }
  });

  test("an invoice inserted with only estimate_id inherits the account (structural S2 fix)", async () => {
    test.skip(!migrationReady, "run migration 20261128000000_customer_accounts.sql first");
    const sb = db!;
    const token = `acctrls${run}${Date.now() % 1e7}`;
    const ins = await sb.from("invoices").insert({
      estimate_id: estimateA, kind: "deposit", token, status: "draft",
    }).select("id, account_id").single();
    if (ins.error) throw new Error(ins.error.message);
    invoiceA = ins.data.id;
    expect(ins.data.account_id).toBe(accountA);
  });
});
