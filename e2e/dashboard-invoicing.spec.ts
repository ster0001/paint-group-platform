import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 4 — Invoicing, as a FINANCE login (brief Part D,
 * session 4 e2e): the home tiles equal the /invoicing dashboard's pulse tiles
 * at the same instant (acceptance 2), every count tile equals its rows, the
 * fixture's overdue invoice is where it should be, the export goes through
 * the one route, and a sales metric is 403. Cleaned up in afterAll.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

const digits = (s: string | null) => Number((s ?? "").replace(/[^\d]/g, ""));

test.describe("dashboard · session 4 · invoicing", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const password = "painttest123";
  const finEmail = `pg.e2e.fin.${run}@example.com`;
  let finId = ""; let estimateId = ""; let invoiceId = "";
  const daysFrom = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  test.beforeAll(async () => {
    const made = await db!.auth.admin.createUser({ email: finEmail, password, email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    finId = made.data.user!.id;
    const prof = await db!.from("profiles").upsert({ id: finId, role: "staff", name: `Jo ${run}`, is_owner: false, staff_access: {}, staff_roles: ["finance"] }, { onConflict: "id" });
    if (prof.error) throw new Error(prof.error.message);
    const est = await db!.from("estimates").insert({
      status: "accepted", source: "manual", level_of_finish: 3, title: `Invoiced ${run}`, accepted_name: `Lachlan ${run}`, accepted_at: new Date().toISOString(),
      lead_source: "unknown", total_cents: 400_000, subtotal_cents: 363_636, builder_state: { blocks: [] }, share_token: `s4${randomBytes(18).toString("base64url")}`,
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
    // A final, issued 30 days ago, due 16 days ago, nothing paid: overdue, in the 8–30 bucket.
    const inv = await db!.from("invoices").insert({
      estimate_id: estimateId, kind: "final", status: "sent", number: `INV-E2E-${run}`, total_inc_cents: 400_000, subtotal_ex_cents: 363_636, gst_cents: 36_364,
      issued_on: daysFrom(-30), due_on: daysFrom(-16), token: `s4i${randomBytes(18).toString("base64url")}`,
    }).select("id").single();
    if (inv.error) throw new Error(inv.error.message);
    invoiceId = inv.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (invoiceId) await db.from("invoices").delete().eq("id", invoiceId);
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    if (finId) await db.auth.admin.deleteUser(finId);
  });

  test("a finance login: Invoicing tiles equal /invoicing at the same instant; every count equals its rows", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, { email: finEmail, password }, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("section-invoicing")).toBeVisible();
    await expect(page.getByTestId("switches-on-invoicing")).toHaveCount(0);
    const homeOutstanding = digits(await page.getByTestId("tile-value-inv.outstanding_cents").textContent());
    const homeOverdue = digits(await page.getByTestId("tile-value-inv.overdue_cents").textContent());
    const homeToPay = digits(await page.getByTestId("tile-value-inv.contractors_to_pay_cents").textContent());

    // The same instant, the /invoicing dashboard's own tiles (its money format drops cents too).
    await page.goto("/invoicing");
    await expect(page.getByTestId("tile-outstanding")).toBeVisible({ timeout: 30_000 });
    expect(digits(await page.getByTestId("tile-outstanding").textContent())).toBe(homeOutstanding);
    expect(digits(await page.getByTestId("tile-overdue").textContent())).toBe(homeOverdue);
    // Approved-to-pay: /invoicing's Payables shows "to pay this week"; Home shows all approved — compare the shared to-approve line instead.
    const toApproveInvoicing = digits(await page.getByTestId("tile-to-approve").textContent());
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 30_000 });
    expect(digits(await page.getByTestId("tile-value-inv.contractors_to_pay_cents").textContent())).toBe(homeToPay);
    const toApproveNote = (await page.getByTestId("tile-note-inv.contractors_to_pay_cents").textContent()) ?? "";
    expect(digits(toApproveNote.split("·")[1] ?? "0")).toBe(toApproveInvoicing);

    // The fixture's overdue invoice is in Overdue with its days, and in the 8–30 bucket note.
    await page.getByTestId("tile-inv.overdue_cents").click();
    const drill = page.getByTestId("drill-inv.overdue_cents");
    await expect(drill).toBeVisible();
    await expect(drill.locator("tr", { hasText: `INV-E2E-${run}` })).toContainText("16");
    await expect(page.getByTestId("tile-note-inv.overdue_cents")).toContainText("8–30");
    await page.getByTestId("tile-inv.overdue_cents").click();

    // Count tiles equal their rows.
    for (const key of ["inv.deposits_unpaid_soon"]) {
      const shown = digits(await page.getByTestId(`tile-value-${key}`).textContent());
      await page.getByTestId(`tile-${key}`).click();
      const d = page.getByTestId(`drill-${key}`);
      await expect(d).toBeVisible();
      expect(Number(((await d.locator(".drill-head .mono").textContent()) ?? "").replace(/[^\d].*$/, ""))).toBe(shown);
      await page.getByTestId(`tile-${key}`).click();
    }
    // Only Invoicing and Activity for a finance login.
    const sections = await page.locator("section[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")));
    expect(sections).toEqual(["invoicing", "activity"]);
  });

  test("the export goes through the one route; a sales metric is 403 for finance", async ({ page }) => {
    await signIn(page, { email: finEmail, password }, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    const ok = await page.request.get("/api/reporting/export?metric=inv.overdue_cents");
    expect(ok.status()).toBe(200);
    const text = (await ok.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")[0]).toContain("Invoice,Customer,Address,Kind,Status");
    expect(text).toContain(`INV-E2E-${run}`);
    const refused = await page.request.get("/api/reporting/export?metric=sales.sales_cents&preset=this_month");
    expect(refused.status()).toBe(403);
  });
});
