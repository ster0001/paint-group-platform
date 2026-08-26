import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";

/**
 * 3a-3 · Money in the portal, as the signed-in customer.
 *
 * What must hold: issued invoices and receipts render with AUD inc GST and
 * the GST itemised; DRAFTS NEVER RENDER (the office's business); paid rows
 * carry their receipt; the not-yet-invoiced remainder reads as "balance on
 * completion"; the empty state is honest; and the receipt PDF route refuses
 * anyone but the owner with a 404.
 */

const db: SupabaseClient | null = serviceClient();

test.describe("portal money (3a-3)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal money suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.money.${run}@example.com`;
  const emptyEmail = `pg.e2e.money.empty.${run}@example.com`;
  let estimateId = "";
  let paymentId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts").insert({ email, name: "Margaret Money" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);

    const est = await sb.from("estimates").insert({
      title: "12 Acacia Street", status: "accepted", level_of_finish: 3,
      account_id: acct.data.id, accepted_total_cents: 845_000,
      builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;

    const mkInv = (over: Record<string, unknown>) => ({
      estimate_id: estimateId,
      kind: "deposit",
      status: "issued",
      token: `pm${run}${Math.random().toString(36).slice(2, 10)}`,
      subtotal_ex_cents: 230_455, gst_cents: 23_045, total_inc_cents: 253_500,
      issued_on: "2026-08-13", due_on: "2027-12-31",
      ...over,
    });

    const dep = await sb.from("invoices").insert(mkInv({ number: `INV-E2E${run}A`, status: "paid" })).select("id").single();
    if (dep.error) throw new Error(`deposit fixture: ${dep.error.message}`);
    const due = await sb.from("invoices").insert(
      mkInv({ number: `INV-E2E${run}B`, kind: "progress", subtotal_ex_cents: 90_910, gst_cents: 9_090, total_inc_cents: 100_000 }),
    ).select("id").single();
    if (due.error) throw new Error(`progress fixture: ${due.error.message}`);
    const draft = await sb.from("invoices").insert(
      mkInv({ status: "draft", number: null, issued_on: null }),
    ).select("id").single();
    if (draft.error) throw new Error(`draft fixture: ${draft.error.message}`);

    const payRow = await sb.from("payments").insert({
      invoice_id: dep.data.id, amount_cents: 253_500, status: "succeeded",
      method: "bank_transfer", paid_on: "2026-08-14", receipt_number: `RCT-E2E${run}`,
    }).select("id").single();
    if (payRow.error) throw new Error(`payment fixture: ${payRow.error.message}`);
    paymentId = payRow.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const e of [email, emptyEmail]) {
      await destroyAccountChain(sb, e);
      await deleteUserByEmail(sb, e);
    }
  });

  test("invoices and receipts render honestly — and drafts never do", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/money");

    // The project header: accepted contract inc GST, GST itemised.
    await expect(page.getByText("12 Acacia Street")).toBeVisible();
    await expect(page.getByText("$8,450.00")).toBeVisible();
    await expect(page.getByText("includes GST of $768.18")).toBeVisible();

    // The paid deposit with its receipt, and the due progress claim.
    await expect(page.getByText(`INV-E2E${run}A`)).toBeVisible();
    await expect(page.getByText("Paid 14 Aug")).toBeVisible();
    await expect(page.getByText(`RCT-E2E${run}`)).toBeVisible();
    await expect(page.getByText(`INV-E2E${run}B`)).toBeVisible();
    await expect(page.getByText("Due 31 Dec")).toBeVisible();
    await expect(page.getByText("Includes GST of $90.90")).toBeVisible();

    // Exactly TWO invoice rows: the draft is invisible to customers.
    expect(await page.getByText(/^INV-E2E/).count()).toBe(2);

    // The remainder line: contract minus issued = balance on completion.
    await expect(page.getByText("Balance on completion")).toBeVisible();
    await expect(page.getByText("Not due yet")).toBeVisible();
    await expect(page.getByText("$4,915.00")).toBeVisible(); // 8450 − 2535 − 1000

    // View & pay goes to the existing invoice token page.
    const pay = page.getByRole("link", { name: "View & pay" });
    await expect(pay).toHaveAttribute("href", /^\/i\//);
  });

  test("the receipt PDF route is owner-only — strangers and the signed-out get 404", async ({ page, request }) => {
    const anon = await request.get(`/account/receipt/${paymentId}`, { maxRedirects: 0 });
    expect(anon.status()).toBe(404);

    const sb = db!;
    await page.goto(await magicLinkFor(sb, emptyEmail)); // a different customer
    const stranger = await page.request.get(`/account/receipt/${paymentId}`, { maxRedirects: 0 });
    expect(stranger.status()).toBe(404);
  });

  test("no money yet reads as an honest empty state", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, emptyEmail));
    await page.goto("/account/money");
    await expect(page.getByText(/Nothing to pay, and nothing owing/)).toBeVisible();
  });
});
