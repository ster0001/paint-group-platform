import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Trade portal v2 · Session 5 — the sessions-doc acceptance list:
 *  · trade admin approves within limit → the estimate accepts through the
 *    EXISTING flow: work order created, deposit invoice DRAFTED;
 *  · a user over their limit is WARNED (⚑2 advisory), approves anyway, and
 *    the over-limit record lands on wo_events;
 *  · send-to-owner → the owner opens the token link, signs → accepted,
 *    decision recorded, the Needs-you card clears;
 *  · property references (PO / Claim) print on the estimate document;
 *  · a viewer has no approve action at all (⚑2 hard rule).
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

test.describe("trade approvals (trade portal v2, session 5)", () => {
  test.skip(!db || !url, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const password = "painttest123";
  const admin = { email: `pg.e2e.ta.admin.${run}@example.com`, id: "" };   // no limit
  const capped = { email: `pg.e2e.ta.capped.${run}@example.com`, id: "" }; // $3,000 limit
  const viewer = { email: `pg.e2e.ta.viewer.${run}@example.com`, id: "" };
  let accountId = "";
  let propertyId = "";
  const estimateIds: string[] = [];
  let migrationReady = true;

  // A minimal-but-valid customer snapshot, so /e renders the document.
  const snapshot = (title: string, totalCents: number) => ({
    version: 1,
    company: {
      name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "",
      email: "", estimatorName: "Tom", estimatorTitle: "Estimator", estimatorPhone: "", logoUrl: "",
    },
    estRef: "EST-TA", contactName: "", contactEmail: "",
    jobAddress: "14 Beaumont St, Elwood", jobTitle: title,
    gstRatePct: 10, depositPct: 10,
    baseSubtotalCents: Math.round(totalCents / 1.1),
    totals: { totalCents },
    areas: [], lineItems: [], options: [], paints: [],
    inclusions: [], exclusions: [], terms: "",
    discountMode: "pct", discountPct: 0, discountFixedCents: 0,
    proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  });

  async function mkSentEstimate(title: string, totalCents: number) {
    const est = await db!.from("estimates").insert({
      title, status: "sent", source: "manual", level_of_finish: 3,
      account_id: accountId, property_id: propertyId,
      total_cents: totalCents, share_token: `ta${randomBytes(10).toString("hex")}`,
      sent_at: new Date().toISOString(), builder_state: {},
      sent_snapshot: snapshot(title, totalCents),
    }).select("id, share_token").single();
    if (est.error) throw new Error(est.error.message);
    estimateIds.push(est.data.id);
    return { id: est.data.id as string, token: est.data.share_token as string };
  }

  async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/account/);
  }

  test.beforeAll(async () => {
    const sb = db!;
    const probe = await sb.from("accounts").select("can_approve_for_owner").limit(1);
    if (probe.error) { migrationReady = false; return; }

    for (const u of [admin, capped, viewer]) {
      const created = await sb.auth.admin.createUser({ email: u.email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
      u.id = created.data.user.id;
    }
    const a = await sb.from("accounts").insert({
      email: admin.email, name: "TA e2e Agency", account_type: "trade", org_kind: "real_estate",
    }).select("id").single();
    if (a.error) throw new Error(a.error.message);
    accountId = a.data.id;
    const m = await sb.from("account_users").insert([
      { account_id: accountId, profile_id: admin.id, role: "admin" },
      { account_id: accountId, profile_id: capped.id, role: "approver", approval_limit_cents: 300000 },
      { account_id: accountId, profile_id: viewer.id, role: "viewer" },
    ]);
    if (m.error) throw new Error(m.error.message);

    const p = await sb.from("properties").insert({
      account_id: accountId, address: "14 Beaumont St", suburb: "Elwood", postcode: "3184",
      address_norm: `14 beaumont st elwood 3184 ${run}`,
    }).select("id").single();
    if (p.error) throw new Error(p.error.message);
    propertyId = p.data.id;
    const refs = await sb.from("property_references").insert([
      { property_id: propertyId, label: "PO", value: `PO-${run}`, sort: 0 },
      { property_id: propertyId, label: "Claim", value: `SC-${run}-M`, sort: 1 },
    ]);
    if (refs.error) throw new Error(refs.error.message);
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const e of estimateIds) {
      const { data: wos } = await sb.from("work_orders").select("id").eq("estimate_id", e);
      for (const w of wos ?? []) {
        await sb.from("wo_events").delete().eq("work_order_id", w.id);
        await sb.from("wo_surfaces").delete().eq("work_order_id", w.id);
        await sb.from("wo_checklist_items").delete().eq("work_order_id", w.id);
        await sb.from("work_orders").delete().eq("id", w.id);
      }
      const { data: invs } = await sb.from("invoices").select("id").eq("estimate_id", e);
      for (const i of invs ?? []) {
        await sb.from("payments").delete().eq("invoice_id", i.id);
        await sb.from("invoices").delete().eq("id", i.id);
      }
      await sb.from("external_approvals").delete().eq("estimate_id", e);
      await sb.from("estimate_events").delete().eq("estimate_id", e);
      await sb.from("estimate_messages").delete().eq("estimate_id", e);
      await sb.from("estimates").delete().eq("id", e);
    }
    if (propertyId) {
      await sb.from("colour_records").delete().eq("property_id", propertyId);
      await sb.from("property_references").delete().eq("property_id", propertyId);
      await sb.from("properties").delete().eq("id", propertyId);
    }
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    for (const u of [admin, capped, viewer]) if (u.id) await sb.auth.admin.deleteUser(u.id);
  });

  test("references print on the estimate document", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261215000000_trade_approvals.sql first");
    const est = await mkSentEstimate(`TA refs ${run}`, 484000);
    await page.goto(`/e/${est.token}`);
    const line = page.getByTestId("references-line");
    await expect(line).toContainText(`PO · PO-${run}`);
    await expect(line).toContainText(`Claim · SC-${run}-M`);
  });

  test("admin approves within limit → accepted, WO created, deposit invoice drafted", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261215000000_trade_approvals.sql first");
    test.setTimeout(120_000);
    const est = await mkSentEstimate(`TA within ${run}`, 484000);
    await login(page, admin.email);
    await page.goto(`/account/approvals/${est.id}`);
    await expect(page.getByTestId("approval-total")).toContainText("4,840.00");
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("approval-done")).toBeVisible();

    const sb = db!;
    const { data: e } = await sb.from("estimates").select("status, accepted_name").eq("id", est.id).single();
    expect(e?.status).toBe("accepted");
    const { data: wo } = await sb.from("work_orders").select("id").eq("estimate_id", est.id);
    expect(wo?.length).toBe(1);
    const { data: dep } = await sb.from("invoices").select("kind, status").eq("estimate_id", est.id);
    expect(dep?.some((i) => i.kind === "deposit" && i.status === "draft")).toBe(true);
  });

  test("over-limit is advisory: warned, approves anyway, recorded on the job timeline", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261215000000_trade_approvals.sql first");
    test.setTimeout(120_000);
    const est = await mkSentEstimate(`TA overlimit ${run}`, 484000); // > $3,000 limit
    await login(page, capped.email);
    await page.goto(`/account/approvals/${est.id}`);
    await page.getByTestId("approve").click();
    const warning = page.getByTestId("over-limit-warning");
    await expect(warning).toContainText("Over your approval limit");
    await expect(warning).toContainText("$3,000.00");
    await page.getByTestId("approve-anyway").click();
    await expect(page.getByTestId("approval-done")).toBeVisible();

    const sb = db!;
    const { data: e } = await sb.from("estimates").select("status").eq("id", est.id).single();
    expect(e?.status).toBe("accepted");
    const { data: wo } = await sb.from("work_orders").select("id").eq("estimate_id", est.id).single();
    const { data: ev } = await sb.from("wo_events").select("meta").eq("work_order_id", wo!.id).eq("type", "approved_over_limit");
    expect(ev?.length).toBe(1);
    expect((ev![0] as { meta: { limitCents: number } }).meta.limitCents).toBe(300000);
  });

  test("send to owner → owner signs on the token link → accepted, card cleared", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261215000000_trade_approvals.sql first");
    test.setTimeout(120_000);
    const est = await mkSentEstimate(`TA owner ${run}`, 484000);
    await login(page, admin.email);
    await page.goto(`/account/approvals/${est.id}`);
    await page.getByTestId("send-open").click();
    await page.getByTestId("send-name").fill("T. Nguyen");
    await page.getByTestId("send-email").fill(`pg.e2e.owner.${run}@example.com`);
    await page.getByTestId("send-go").click();
    await expect(page.getByTestId("external-sent")).toBeVisible();

    // The Needs-you card now reads "sent to", not "review".
    await page.goto("/account");
    await expect(page.getByText(`Sent to T. Nguyen to approve — awaiting their decision`)).toBeVisible();

    const sb = db!;
    const { data: appr } = await sb.from("external_approvals")
      .select("token").eq("estimate_id", est.id).single();
    const token = (appr as { token: string }).token;

    // The owner: no login, opens the link, reads, signs.
    await page.context().clearCookies();
    await page.goto(`/a/${token}`);
    await expect(page.getByText(`PO · PO-${run}`)).toBeVisible();
    await page.getByTestId("open-approve").click();
    await page.getByTestId("sign-name").fill("Thanh Nguyen");
    await page.getByTestId("sign-approve").click();
    await expect(page.getByTestId("external-approved")).toBeVisible();

    const { data: e } = await sb.from("estimates").select("status, accepted_name").eq("id", est.id).single();
    expect(e?.status).toBe("accepted");
    expect(e?.accepted_name).toBe("Thanh Nguyen");
    const { data: decided } = await sb.from("external_approvals")
      .select("decision, signer_name, viewed_at").eq("estimate_id", est.id).single();
    expect(decided?.decision).toBe("approved");
    expect(decided?.viewed_at).toBeTruthy();

    // Accepted → the sender's Needs-you card is gone.
    await login(page, admin.email);
    await expect(page.getByText("Sent to T. Nguyen to approve", { exact: false })).toHaveCount(0);
  });

  test("a viewer has no approve action at all", async ({ page }) => {
    test.skip(!migrationReady, "run migration 20261215000000_trade_approvals.sql first");
    test.setTimeout(120_000);
    const est = await mkSentEstimate(`TA viewer ${run}`, 484000);
    await login(page, viewer.email);
    await page.goto(`/account/approvals/${est.id}`);
    await expect(page.getByTestId("no-approve-role")).toBeVisible();
    await expect(page.getByTestId("approve")).toHaveCount(0);
    await expect(page.getByTestId("send-open")).toHaveCount(0);
  });
});
