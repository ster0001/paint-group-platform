import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge 8b — what only the old Payables tab did, now on the Contractors tab.
 *
 *  · A draft RCTI waits under To approve and is approved there.
 *  · Green fast terms show as a chip; Hold (with a reason) and Release.
 *  · ✓ Paid can carry the bank reference and the day it was paid.
 *  · Expense claims: Approve / Reject. Ask first: Approve up to a cap / Decline.
 *  · A customer can't call the expense functions.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PX8${Date.now().toString(36).slice(-5).toUpperCase()}`;
const PAGE = `/invoicing?tab=con&q=${stamp}`;
const made: PaymentsJob[] = [];
const ciIds: string[] = [];
const expenseIds: string[] = [];
const askIds: string[] = [];

const ciRow = (page: Page, number: string) => page.locator(".pm .prow", { hasText: number });
const ci = async (id: string) => ((await db!.from("contractor_invoices").select("status, terms_kind, terms_hold_reason, bank_reference, paid_at").eq("id", id).single()).data as
  { status: string; terms_kind: string; terms_hold_reason: string | null; bank_reference: string | null; paid_at: string | null });

test.describe("Payments → Contractors 8b — a customer can't decide expenses", () => {
  test("an anonymous session is refused", async () => {
    const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await visitor.auth.signInAnonymously()).error).toBeNull();
    const nobody = "00000000-0000-4000-8000-000000000000";
    for (const [fn, args] of [
      ["contractor_expense_decide", { p_id: nobody, p_approve: true }],
      ["expense_preapproval_decide", { p_id: nobody, p_approve: true, p_cap_cents: 100 }],
      ["contractor_invoice_hold_fast_terms", { p_id: nobody, p_reason: "nope" }],
    ] as const) {
      const { data, error } = await visitor.rpc(fn, args);
      expect(error?.code === "42501" || /not_staff|forbidden/.test(String(data)), `${fn}: ${JSON.stringify(data ?? error)}`).toBe(true);
    }
  });
});

test.describe("Payments → Contractors 8b — as staff", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    if (expenseIds.length) await db.from("contractor_expenses").delete().in("id", expenseIds);
    if (askIds.length) await db.from("expense_preapprovals").delete().in("id", askIds);
    if (ciIds.length) {
      await db.from("wo_events").delete().in("meta->>contractor_invoice_id", ciIds);
      await db.from("contractor_invoices").delete().in("id", ciIds);
    }
    await cleanupPaymentsJobs(db, made);
  });

  test("RCTI approve, Hold and Release, Paid with a reference, claims and ask-first", async ({ page }) => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Expjob", { contractCents: 800_000, stage: "in_progress", startDate: isoDay(-3), invoices: [] });
    made.push(j);
    // The agreed pay a draft RCTI is worked out from when it is approved.
    const { error: payErr } = await db!.from("work_orders").update({ contractor_payment_cents: 300_000 }).eq("id", j.f.workOrderId);
    if (payErr) throw payErr;
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    const mk = async (n: string, over: Record<string, unknown>) => {
      const { data, error } = await db!.from("contractor_invoices").insert({
        work_order_id: j.f.workOrderId, contractor_id: cid, number: `CI-${stamp}${n}`, subtotal_ex_cents: 100_000, total_inc_cents: 100_000, claimed_ex_cents: 100_000,
        submitted_at: new Date().toISOString(), ...over,
      }).select("id").single();
      if (error) throw error;
      ciIds.push(data!.id as string);
      return data!.id as string;
    };
    const rcti = await mk("R", { status: "draft", rcti: true, submitted_at: null });
    const green = await mk("G", { status: "approved", terms_kind: "green_fast", due_on: isoDay(3), approved_at: new Date().toISOString() });
    const { data: claim, error: cErr } = await db!.from("contractor_expenses").insert({
      work_order_id: j.f.workOrderId, contractor_id: cid, category: "materials", amount_cents: 12_345, receipt_path: `receipts/e2e/${stamp}.jpg`, note: `${stamp} drop sheets`,
    }).select("id").single();
    if (cErr) throw cErr;
    expenseIds.push(claim!.id as string);
    const { data: ask, error: aErr } = await db!.from("expense_preapprovals").insert({
      work_order_id: j.f.workOrderId, contractor_id: cid, description: `${stamp} scissor lift`, est_cents: 80_000,
    }).select("id").single();
    if (aErr) throw aErr;
    askIds.push(ask!.id as string);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(PAGE);

    // A draft RCTI is the office's to approve.
    const toApprove = page.locator(".pm .sec", { has: page.getByRole("heading", { name: "To approve" }) });
    await expect(toApprove.locator(".prow", { hasText: `CI-${stamp}R` })).toContainText("RCTI", { timeout: 30_000 });
    await ciRow(page, `CI-${stamp}R`).getByRole("button", { name: "Approve" }).click();
    await expect.poll(async () => (await ci(rcti)).status, { timeout: 20_000 }).toBe("approved");

    // Green fast terms: the chip, Hold with a reason, Release.
    await page.reload();
    const g = ciRow(page, `CI-${stamp}G`);
    await expect(g).toContainText("Green · 3 business days", { timeout: 30_000 });
    page.once("dialog", (d) => void d.accept("Customer raised a scuff"));
    await g.getByRole("button", { name: "Hold fast payment" }).click();
    await expect.poll(async () => (await ci(green)).terms_kind, { timeout: 20_000 }).toBe("held");
    await expect(g).toContainText("Held — Customer raised a scuff", { timeout: 20_000 });
    await g.getByRole("button", { name: "Release" }).click();
    await expect.poll(async () => (await ci(green)).terms_kind, { timeout: 20_000 }).toBe("green_fast");

    // ✓ Paid with the bank reference and the day it went.
    const paidOn = isoDay(-1);
    await g.getByRole("button", { name: "Paid, with reference…" }).click();
    const sheet = page.getByRole("dialog", { name: "Record the payment" });
    await sheet.getByLabel("Bank reference").fill(`NAB ${stamp}`);
    await sheet.getByLabel("Date paid").fill(paidOn);
    await sheet.getByRole("button", { name: "Mark paid" }).click();
    await expect.poll(async () => (await ci(green)).status, { timeout: 20_000 }).toBe("paid");
    const paid = await ci(green);
    expect(paid.bank_reference).toBe(`NAB ${stamp}`);
    expect(paid.paid_at?.slice(0, 10)).toBe(paidOn);

    // Expense claims and ask-first, on the same tab.
    await page.goto(`/invoicing?tab=con`);
    const claimRow = page.getByTestId("expense-claims").locator(`[data-expense="${claim!.id}"]`);
    await expect(claimRow).toContainText("$123.45", { timeout: 30_000 });
    await claimRow.getByRole("button", { name: "Approve" }).click();
    await expect.poll(async () => ((await db!.from("contractor_expenses").select("status").eq("id", claim!.id).single()).data as { status: string }).status, { timeout: 20_000 }).toBe("approved");

    const askRow = page.getByTestId("preapprovals").locator(`[data-expense="${ask!.id}"]`);
    await askRow.getByRole("button", { name: "Approve…" }).click();
    await askRow.getByLabel("Approve up to").fill("650");
    await askRow.getByRole("button", { name: "Approve up to $650.00" }).click();
    await expect.poll(async () => (await db!.from("expense_preapprovals").select("status, cap_cents").eq("id", ask!.id).single()).data, { timeout: 20_000 })
      .toEqual({ status: "approved", cap_cents: 65_000 });

    // The ledger card counts what's left to decide (ours are both decided now).
    await page.reload();
    await expect(page.getByTestId("pm-expenses").locator(`[data-expense="${claim!.id}"]`)).toHaveCount(0);
  });
});
