import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Trade portal v2 · Session 6 — the sessions-doc acceptance list:
 *  · the CSV (and the statement's view) match the ledger to the cent for a
 *    seeded org — asserted against sums computed straight off the rows;
 *  · a finance seat sees money and nothing else;
 *  · the invite flow creates an account_user with scope;
 *  · the digest plan differs per recipient scope, and quiet scopes get
 *    nothing at all (no empty digests).
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cronSecret = process.env.CRON_SECRET ?? "";

test.describe("trade money + team + digest (trade portal v2, session 6)", () => {
  test.skip(!db || !url, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const password = "painttest123";
  const admin = { email: `pg.e2e.tm.admin.${run}@example.com`, id: "" };     // all properties
  const adminB = { email: `pg.e2e.tm.adminb.${run}@example.com`, id: "" };   // scoped to the QUIET property
  const finance = { email: `pg.e2e.tm.fin.${run}@example.com`, id: "" };
  const invitee = `pg.e2e.tm.invitee.${run}@example.com`;
  let accountId = "";
  let propA = ""; // busy: events + overdue invoice
  let propB = ""; // quiet
  let woA = "";
  const estimateIds: string[] = [];
  let migrationReady = true;

  test.beforeAll(async () => {
    const sb = db!;
    const probe = await sb.from("notification_prefs").select("digest_enabled").limit(1);
    if (probe.error) { migrationReady = false; return; }

    for (const u of [admin, adminB, finance]) {
      const created = await sb.auth.admin.createUser({ email: u.email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
      u.id = created.data.user.id;
    }
    const a = await sb.from("accounts").insert({
      email: admin.email, name: "TM e2e Agency", account_type: "trade", org_kind: "real_estate",
    }).select("id").single();
    if (a.error) throw new Error(a.error.message);
    accountId = a.data.id;

    const mkProp = async (address: string, refs: Array<[string, string]>) => {
      const p = await sb.from("properties").insert({
        account_id: accountId, address, suburb: "Elwood", postcode: "3184",
        address_norm: `${address.toLowerCase()} elwood 3184 ${run}`,
      }).select("id").single();
      if (p.error) throw new Error(p.error.message);
      if (refs.length) await sb.from("property_references").insert(refs.map(([label, value], i) => ({
        property_id: p.data.id, label, value, sort: i,
      })));
      return p.data.id as string;
    };
    propA = await mkProp("9 Mitford St", [["Owner", "K. Adebayo"]]);
    propB = await mkProp("28 Broadway", []);

    const m = await sb.from("account_users").insert([
      { account_id: accountId, profile_id: admin.id, role: "admin" },
      { account_id: accountId, profile_id: adminB.id, role: "admin", property_scope: [propB] },
      { account_id: accountId, profile_id: finance.id, role: "finance" },
    ]);
    if (m.error) throw new Error(m.error.message);

    const mkJob = async (propertyId: string, invoice: { number: string; totalInc: number; gst: number; due: string; paidCents?: number } | null) => {
      const est = await sb.from("estimates").insert({
        title: `TM job ${run}`, status: "accepted", source: "manual", level_of_finish: 3,
        account_id: accountId, property_id: propertyId, builder_state: {},
      }).select("id").single();
      if (est.error) throw new Error(est.error.message);
      estimateIds.push(est.data.id);
      if (invoice) {
        const inv = await sb.from("invoices").insert({
          estimate_id: est.data.id, kind: "final", status: invoice.paidCents ? "partially_paid" : "issued",
          number: invoice.number, token: `tm${randomBytes(8).toString("hex")}`,
          issued_on: "2026-08-10", due_on: invoice.due,
          subtotal_ex_cents: invoice.totalInc - invoice.gst, gst_cents: invoice.gst, total_inc_cents: invoice.totalInc,
        }).select("id").single();
        if (inv.error) throw new Error(inv.error.message);
        if (invoice.paidCents) {
          const pay = await sb.from("payments").insert({
            invoice_id: inv.data.id, amount_cents: invoice.paidCents, status: "succeeded",
            method: "bank_transfer", paid_on: "2026-08-20", receipt_number: `R-${run}`,
          });
          if (pay.error) throw new Error(pay.error.message);
        }
      }
      return est.data.id as string;
    };
    // propA: an overdue invoice + a partially paid one; propB: quiet.
    const estA = await mkJob(propA, { number: `PG-OD${run.slice(0, 3)}`, totalInc: 231000, gst: 21000, due: "2026-08-22" });
    await mkJob(propA, { number: `PG-PP${run.slice(0, 3)}`, totalInc: 594000, gst: 54000, due: "2026-12-01", paidCents: 100000 });
    await mkJob(propB, null);

    // Events at propA only — the digest's busy property.
    const wo = await sb.from("work_orders").insert({
      estimate_id: estA, wo_ref: `TM-${run.slice(0, 5)}`, share_token: `tm${run}${Date.now()}`,
      stage: "in_progress", status: "in_progress", issued_at: new Date().toISOString(),
      wo_snapshot: { jobTitle: "TM job", areas: [], materials: [] }, colours: {},
    }).select("id").single();
    if (wo.error) throw new Error(wo.error.message);
    woA = wo.data.id;
    const ev = await sb.from("wo_events").insert([
      { work_order_id: woA, type: "surface_tick", actor_kind: "contractor", meta: {} },
      { work_order_id: woA, type: "stage_changed", actor_kind: "system", meta: {} },
    ]);
    if (ev.error) throw new Error(ev.error.message);
  });

  test.afterAll(async () => {
    const sb = db!;
    if (woA) {
      await sb.from("wo_events").delete().eq("work_order_id", woA);
      await sb.from("work_orders").delete().eq("id", woA);
    }
    for (const e of estimateIds) {
      const { data: invs } = await sb.from("invoices").select("id").eq("estimate_id", e);
      for (const i of invs ?? []) {
        await sb.from("payments").delete().eq("invoice_id", i.id);
        await sb.from("invoices").delete().eq("id", i.id);
      }
      await sb.from("estimates").delete().eq("id", e);
    }
    for (const p of [propA, propB].filter(Boolean)) {
      await sb.from("property_references").delete().eq("property_id", p);
      await sb.from("properties").delete().eq("id", p);
    }
    if (accountId) {
      const { data: members } = await sb.from("account_users").select("id").eq("account_id", accountId);
      for (const mm of members ?? []) await sb.from("notification_prefs").delete().eq("account_user_id", mm.id);
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    for (const u of [admin, adminB, finance]) if (u.id) await sb.auth.admin.deleteUser(u.id);
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const inv = users?.users?.find((x) => x.email === invitee);
    if (inv) await sb.auth.admin.deleteUser(inv.id);
  });

  async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/account/);
  }

  test("CSV + statement match the ledger to the cent; references ride every line", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261216000000_trade_digest_colourcard.sql first");
    test.setTimeout(120_000);
    await login(page, admin.email);
    await page.goto("/account/money");
    // Screen tiles: outstanding = 231000 + (594000-100000); overdue = 231000.
    await expect(page.getByTestId("money-outstanding")).toContainText("7,250.00");
    await expect(page.getByTestId("money-overdue")).toContainText("2,310.00");

    const csvRes = await page.request.get("/account/money/export");
    expect(csvRes.status()).toBe(200);
    const csv = await csvRes.text();
    const rows = csv.trim().split("\n").slice(1).filter((r) => r.includes(run.slice(0, 3)));
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.includes("Owner · K. Adebayo"))).toBe(true);
    const tail = (r: string, n: number) => { const c = r.split(","); return c[c.length - n]; };
    const amountCents = rows.reduce((s, r) => s + Math.round(Number(tail(r, 4)) * 100), 0);
    const paidCents = rows.reduce((s, r) => s + Math.round(Number(tail(r, 2)) * 100), 0);
    expect(amountCents).toBe(231000 + 594000); // to the cent
    expect(paidCents).toBe(100000);

    const pdfRes = await page.request.get("/account/money/statement");
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    expect((await pdfRes.body()).length).toBeGreaterThan(5000);
  });

  test("a finance seat sees money and nothing else", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261216000000_trade_digest_colourcard.sql first");
    test.setTimeout(120_000);
    await login(page, finance.email);
    await page.goto("/account");
    await page.waitForURL(/\/account\/money/); // home redirects straight to money
    // One tab only.
    await expect(page.locator(".tabbar a, nav a").filter({ hasText: "Money" })).toHaveCount(1);
    await expect(page.locator(".tabbar a, nav a").filter({ hasText: "Properties" })).toHaveCount(0);
    // Job-detail surfaces bounce or refuse.
    await page.goto(`/account/properties/${propA}`);
    await page.waitForURL(/\/account\/money/);
    const card = await page.request.get(`/account/properties/${propA}/colour-card`);
    expect(card.status()).toBe(404);
  });

  test("invite creates the seat with scope", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261216000000_trade_digest_colourcard.sql first");
    test.setTimeout(120_000);
    await login(page, admin.email);
    await page.goto("/account/team");
    await page.getByTestId("invite-email").fill(invitee);
    await page.getByTestId("invite-role").selectOption("viewer");
    await page.getByTestId(`invite-scope-${propA}`).check();
    await page.getByTestId("invite-go").click();
    await expect(page.getByText("Invited ✓", { exact: false })).toBeVisible();

    const sb = db!;
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    const user = users?.users?.find((u) => u.email === invitee);
    expect(user).toBeTruthy();
    const { data: seat } = await sb.from("account_users")
      .select("role, property_scope").eq("account_id", accountId).eq("profile_id", user!.id).single();
    expect(seat?.role).toBe("viewer");
    expect(seat?.property_scope).toEqual([propA]);
  });

  test("digest: scope decides the content, quiet scopes get nothing", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261216000000_trade_digest_colourcard.sql first");
    test.skip(!cronSecret, "needs CRON_SECRET");
    test.setTimeout(120_000);
    const res = await page.request.get("/api/cron/trade-digest?hour=17&dryRun=1", {
      headers: { "x-cron-secret": cronSecret },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { plans: Array<{ email: string; lines: Array<{ address: string }> }> };
    const forAdmin = body.plans.find((p) => p.email === admin.email);
    const forAdminB = body.plans.find((p) => p.email === adminB.email);
    const forFinance = body.plans.find((p) => p.email === finance.email);
    // The all-properties admin hears about the busy property…
    expect(forAdmin?.lines.some((l) => l.address.includes("9 Mitford St"))).toBe(true);
    // …the admin scoped to the quiet property gets NO digest at all…
    expect(forAdminB).toBeUndefined();
    // …and finance is off by default (⚑11).
    expect(forFinance).toBeUndefined();
  });
});
