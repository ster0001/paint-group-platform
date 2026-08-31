import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Trade portal v2 · Session 7 — the three-persona proof (brief §7 row 7),
 * against the seeded demo orgs (run scripts/portal/seed-trade-demo.mjs
 * first; every test skips with that instruction when they're absent).
 *
 *  · The two 10-second questions (§1): "what colour is the hallway at
 *    Unit 7/22 Ormond Rd" and "is Ormond Rd finishing on <day>" — each
 *    answered inside 10 s of the portfolio opening.
 *  · Approve-within-limit (agency), send-to-assessor + external sign
 *    (insurer), the PO prompt (facilities), finance-only login.
 *  · Persona framing is DATA, not code: the reference labels asserted here
 *    come from property_references rows; org kinds beyond the three
 *    examples fall back to generic approval copy.
 *
 * Decision surfaces get DISPOSABLE estimates created here and removed
 * after — the seeded walk states stay intact for Tom's side-by-side.
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PASSWORD = "painttest123";
const AGENCY = "pg.demo.agency@example.com";
const FACILITIES = "pg.demo.facilities@example.com";
const INSURER = "pg.demo.insurer@example.com";
const FINANCE = "pg.demo.finance@example.com";

test.describe("three personas (trade portal v2, session 7)", () => {
  test.skip(!db || !url, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  let agencyId = "";
  let insurerId = "";
  let facilitiesId = "";
  let ormondId = "";
  let ormondEnd = "";
  const disposable: string[] = []; // estimate ids created here
  let seeded = true;

  test.beforeAll(async () => {
    const sb = db!;
    const { data: orgs } = await sb.from("accounts").select("id, email")
      .in("email", [AGENCY, FACILITIES, INSURER]);
    const byEmail = new Map(((orgs ?? []) as Array<{ id: string; email: string }>).map((o) => [o.email, o.id]));
    agencyId = byEmail.get(AGENCY) ?? "";
    facilitiesId = byEmail.get(FACILITIES) ?? "";
    insurerId = byEmail.get(INSURER) ?? "";
    if (!agencyId || !facilitiesId || !insurerId) { seeded = false; return; }

    const { data: ormond } = await sb.from("properties").select("id")
      .eq("account_id", agencyId).ilike("address", "%Ormond%").maybeSingle();
    ormondId = (ormond as { id: string } | null)?.id ?? "";
    if (ormondId) {
      const { data: est } = await sb.from("estimates").select("id, work_orders(end_date, stage)")
        .eq("property_id", ormondId);
      for (const e of (est ?? []) as Array<{ work_orders: Array<{ end_date: string | null; stage: string }> | { end_date: string | null; stage: string } | null }>) {
        const wos = Array.isArray(e.work_orders) ? e.work_orders : e.work_orders ? [e.work_orders] : [];
        const active = wos.find((w) => w.stage === "in_progress");
        if (active?.end_date) ormondEnd = active.end_date;
      }
    }
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const e of disposable) {
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
      await sb.from("estimates").delete().eq("id", e);
    }
  });

  async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/account/);
  }

  async function disposableEstimate(accountId: string, propertyLike: string, title: string) {
    const sb = db!;
    const { data: prop } = await sb.from("properties").select("id")
      .eq("account_id", accountId).ilike("address", `%${propertyLike}%`).limit(1).maybeSingle();
    const est = await sb.from("estimates").insert({
      title, status: "sent", source: "manual", level_of_finish: 3,
      account_id: accountId, property_id: (prop as { id: string } | null)?.id ?? null,
      total_cents: 484000, share_token: `p7${randomBytes(10).toString("hex")}`,
      sent_at: new Date().toISOString(), builder_state: {},
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    disposable.push(est.data.id);
    return est.data.id as string;
  }

  test("10 seconds: what colour is the hallway at Unit 7/22 Ormond Rd?", async ({ page }) => {
    test.skip(!seeded || !ormondId, "run scripts/portal/seed-trade-demo.mjs first");
    test.setTimeout(120_000);
    await login(page, AGENCY);
    const t0 = Date.now();
    await page.goto("/account");
    await page.getByTestId("portfolio-search").fill("Ormond");
    await page.getByTestId(`prop-${ormondId}`).click();
    await page.getByTestId("ptab-colours").click();
    await expect(page.getByText("Hallway")).toBeVisible();
    await expect(page.getByTestId("pane-colours").getByText("Natural White").first()).toBeVisible();
    const elapsed = Date.now() - t0;
    console.log(`[10s] hallway colour answered in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10_000);
  });

  test("10 seconds: is Ormond Rd finishing on its expected day?", async ({ page }) => {
    test.skip(!seeded || !ormondId || !ormondEnd, "run scripts/portal/seed-trade-demo.mjs first");
    test.setTimeout(120_000);
    await login(page, AGENCY);
    const t0 = Date.now();
    await page.goto("/account");
    await expect(page.getByTestId(`prop-${ormondId}`)).toContainText(/On site · day \d+ of \d+/i);
    await page.getByTestId(`prop-${ormondId}`).click();
    await expect(page.getByTestId("current-job")).toContainText(`Expected finish ${ormondEnd}`);
    const elapsed = Date.now() - t0;
    console.log(`[10s] finish day answered in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10_000);
  });

  test("agency admin approves within limit — the existing acceptance flow fires", async ({ page }) => {
    test.skip(!seeded, "run scripts/portal/seed-trade-demo.mjs first");
    test.setTimeout(120_000);
    const estId = await disposableEstimate(agencyId, "Broadway", `P7 within-limit ${run}`);
    await login(page, AGENCY);
    await page.goto(`/account/approvals/${estId}`);
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("approval-done")).toBeVisible();
    const { data: e } = await db!.from("estimates").select("status").eq("id", estId).single();
    expect(e?.status).toBe("accepted");
    const { data: dep } = await db!.from("invoices").select("kind, status").eq("estimate_id", estId);
    expect(dep?.some((i) => i.kind === "deposit" && i.status === "draft")).toBe(true);
  });

  test("insurer sends to the assessor; the assessor signs on the token link", async ({ page }) => {
    test.skip(!seeded, "run scripts/portal/seed-trade-demo.mjs first");
    test.setTimeout(120_000);
    const estId = await disposableEstimate(insurerId, "Ashworth", `P7 assessor ${run}`);
    await login(page, INSURER);
    await page.goto(`/account/approvals/${estId}`);
    // Persona copy from org_kind — generic for kinds outside the examples.
    await expect(page.getByTestId("send-open")).toContainText("Send to the assessor to approve");
    await page.getByTestId("send-open").click();
    await page.getByTestId("send-name").fill("P. Ryan");
    await page.getByTestId("send-email").fill(`pg.e2e.assessor.${run}@example.com`);
    await page.getByTestId("send-go").click();
    await expect(page.getByTestId("external-sent")).toBeVisible();

    const { data: appr } = await db!.from("external_approvals").select("token").eq("estimate_id", estId).single();
    await page.context().clearCookies();
    await page.goto(`/a/${(appr as { token: string }).token}`);
    await expect(page.getByText(/Claim · /)).toBeVisible(); // the claim rides the approval page
    await page.getByTestId("open-approve").click();
    await page.getByTestId("sign-name").fill("Patrick Ryan");
    await page.getByTestId("sign-approve").click();
    await expect(page.getByTestId("external-approved")).toBeVisible();
    const { data: e } = await db!.from("estimates").select("status, accepted_name").eq("id", estId).single();
    expect(e?.status).toBe("accepted");
    expect(e?.accepted_name).toBe("Patrick Ryan");
  });

  test("facilities get the PO prompt; the site cards carry Site/PO labels", async ({ page }) => {
    test.skip(!seeded, "run scripts/portal/seed-trade-demo.mjs first");
    test.setTimeout(120_000);
    const estId = await disposableEstimate(facilitiesId, "Block C", `P7 po ${run}`);
    await login(page, FACILITIES);
    await expect(page.getByText("Site · Elwood Village, Block B")).toBeVisible();
    await expect(page.getByText(/PO · BAC-2026/).first()).toBeVisible();
    await page.goto(`/account/approvals/${estId}`);
    await expect(page.getByTestId("po-input")).toBeVisible();
    await expect(page.getByTestId("approve")).toContainText("Approve with PO number");
  });

  test("the finance seat lands on money and sees nothing else", async ({ page }) => {
    test.skip(!seeded, "run scripts/portal/seed-trade-demo.mjs first");
    test.setTimeout(120_000);
    const sb = db!;
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
    test.skip(!users?.users?.some((u) => u.email === FINANCE), "run scripts/portal/seed-trade-demo.mjs first");
    await login(page, FINANCE);
    await page.goto("/account");
    await page.waitForURL(/\/account\/money/);
    await expect(page.getByTestId("money-outstanding")).toBeVisible();
    await expect(page.locator("nav a, .tabbar a").filter({ hasText: "Properties" })).toHaveCount(0);
  });
});
