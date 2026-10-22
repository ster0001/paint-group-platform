import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test, userIdFor } from "./helpers";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge, Step 3 — the quick actions (docs/briefs/claude-code-brief-payments-merge.md §4.3).
 * Driven through the real page as staff; the database is read back after each.
 *
 *  · One press records exactly one payment, with recorded_by; a second press records nothing.
 *  · Undo keeps the row (reversed), steps the invoice back, writes the event; no receipt goes.
 *  · Left alone, the receipt is claimed once the Undo window closes (⚑P2, Tom 13 Oct).
 *  · Cash against a draft issues without sending; the switch off sends nothing.
 *  · Send takes the due date from the confirm; once sent it can't change (R13).
 *  · The deposit percentage is computed by the server.
 *  · Change amount on a sent deposit is atomic: refused with a payment on it, original untouched.
 *  · Create deposit invoice on a booked job with none.
 *  · A customer (anonymous session) can't call any of it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PA${Date.now().toString(36).slice(-6).toUpperCase()}`;
const PAGE = "/invoicing";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const made: PaymentsJob[] = [];

async function job(label: string, opts: Parameters<typeof makePaymentsJob>[4]) {
  const j = await makePaymentsJob(db!, contractor!.email, stamp, label, opts);
  made.push(j);
  return j;
}
const invoicesOf = async (j: PaymentsJob) => {
  const { data, error } = await db!.from("invoices").select("id, kind, status, number, total_inc_cents, due_on, voided_reason")
    .eq("estimate_id", j.f.estimateId).order("created_at");
  if (error) throw error;
  return data as Array<{ id: string; kind: string; status: string; number: string | null; total_inc_cents: number; due_on: string | null; voided_reason: string | null }>;
};
const paymentsOf = async (invoiceId: string) => {
  const { data, error } = await db!.from("payments").select("id, status, amount_cents, method, recorded_by, reversed_by, reversal_reason, receipt_sent_at").eq("invoice_id", invoiceId);
  if (error) throw error;
  return data as Array<{ id: string; status: string; amount_cents: number; method: string; recorded_by: string | null; reversed_by: string | null; reversal_reason: string | null; receipt_sent_at: string | null }>;
};
const eventsOf = async (invoiceId: string) => {
  const { data } = await db!.from("invoice_events").select("type, meta").eq("invoice_id", invoiceId).order("created_at");
  return (data ?? []) as Array<{ type: string; meta: Record<string, unknown> }>;
};
const card = (page: Page, j: PaymentsJob) => page.locator(".pm .job", { hasText: j.address });

test.describe("Payments quick actions — a customer can't reach them", () => {
  test("an anonymous session is refused by every new money function", async () => {
    const visitor = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await visitor.auth.signInAnonymously()).error).toBeNull();
    const nobody = "00000000-0000-4000-8000-000000000000";
    for (const [fn, args] of [
      ["invoice_record_full_payment", { p_invoice_id: nobody }],
      ["invoice_payment_undo", { p_payment_id: nobody }],
      ["invoice_set_deposit", { p_invoice_id: nobody, p_mode: "percent", p_value: 30 }],
      ["invoice_set_draft_due", { p_invoice_id: nobody, p_due_on: "2030-01-01" }],
      ["invoice_change_amount", { p_invoice_id: nobody, p_mode: "percent", p_value: 30 }],
      ["invoice_draft_deposit", { p_estimate_id: nobody }],
    ] as const) {
      const { data, error } = await visitor.rpc(fn, args);
      expect(error?.code === "42501" || data === "error:not_staff", `${fn} answered ${JSON.stringify(data ?? error)}`).toBe(true);
    }
    const { error } = await visitor.rpc("payment_claim_receipt", { p_payment_id: nobody });
    expect(error?.code).toBe("42501");
  });
});

test.describe("Payments quick actions — as staff", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    await cleanupPaymentsJobs(db, made);
  });

  test("one press records one payment; Undo reverses it with no receipt; left alone the receipt is claimed after the window", async ({ page }) => {
    const j = await job("Onepress", { contractCents: 400_000, stage: "pre_start", startDate: isoDay(10), invoices: [{ kind: "deposit", status: "sent", total: 200_000, due: isoDay(5) }] });
    const [inv] = await invoicesOf(j);
    const staffId = await userIdFor(staff!);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);

    await card(page, j).getByRole("button", { name: "One-click paid $2,000.00" }).click();
    const toast = page.getByTestId("pm-toast");
    await expect(toast).toContainText("Recorded $2,000.00 from Onepress, bank transfer, today.");
    let pays = await paymentsOf(inv.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ status: "succeeded", amount_cents: 200_000, method: "bank_transfer", recorded_by: staffId });
    expect((await invoicesOf(j))[0].status).toBe("paid");

    // Undo inside the window: the row is kept, reversed, and the invoice is back to sent.
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toContainText("Undone.");
    pays = await paymentsOf(inv.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ status: "reversed", reversed_by: staffId, reversal_reason: "undo", receipt_sent_at: null });
    expect((await invoicesOf(j))[0].status).toBe("sent");
    expect((await eventsOf(inv.id)).map((e) => e.type)).toEqual(expect.arrayContaining(["payment_received", "payment_reversed"]));
    // The deferred sender must find nothing to send once the window has passed.
    await page.waitForTimeout(11_000);
    expect((await paymentsOf(inv.id))[0].receipt_sent_at).toBeNull();

    // Pressed again and left alone: the receipt is claimed when the window closes.
    await page.reload();
    await card(page, j).getByRole("button", { name: "One-click paid $2,000.00" }).click();
    await expect(toast).toContainText("Recorded $2,000.00");
    await page.waitForTimeout(12_000);
    const after = (await paymentsOf(inv.id)).filter((p) => p.status === "succeeded");
    expect(after).toHaveLength(1);
    expect(after[0].receipt_sent_at).not.toBeNull();
    // ...and from then on it can't be undone.
    expect(await rpcAs(staff!, "invoice_payment_undo", { p_payment_id: after[0].id })).toBe("error:receipt_sent");
  });

  test("a second press can't double-record", async () => {
    const j = await job("Twice", { contractCents: 300_000, stage: "in_progress", startDate: isoDay(-2), invoices: [{ kind: "deposit", status: "sent", total: 150_000, due: isoDay(3) }] });
    const [inv] = await invoicesOf(j);
    const results = await Promise.all([
      rpcAs(staff!, "invoice_record_full_payment", { p_invoice_id: inv.id }),
      rpcAs(staff!, "invoice_record_full_payment", { p_invoice_id: inv.id }),
    ]);
    expect(results.filter((r) => r.startsWith("ok:"))).toHaveLength(1);
    expect(results).toContain("error:already_paid");
    expect((await paymentsOf(inv.id)).filter((p) => p.status === "succeeded")).toHaveLength(1);
  });

  test("cash against a draft issues it without sending; the switch off sends nothing", async ({ page }) => {
    const j = await job("Cashjob", { contractCents: 200_000, stage: "pre_start", startDate: isoDay(12), invoices: [{ kind: "deposit", status: "draft", total: 100_000, due: null }] });
    const [inv] = await invoicesOf(j);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);
    await card(page, j).getByRole("button", { name: "Already paid" }).click();
    const sheet = page.getByRole("dialog", { name: "Record a payment" });
    await sheet.getByRole("button", { name: "Cash" }).click();
    await expect(sheet).toContainText("will not be sent");
    const sw = sheet.getByRole("switch", { name: "Send notification of payment" });
    await expect(sw).toHaveAttribute("aria-checked", "true");   // ⚑P4 default on
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sheet.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByTestId("pm-toast")).toContainText("No email sent.");

    const [after] = await invoicesOf(j);
    expect(after.status).toBe("paid");
    expect(after.number).toMatch(/^INV-/);                        // issued — the number is allocated
    const types = (await eventsOf(inv.id)).map((e) => e.type);
    expect(types).toContain("issued");
    expect(types).not.toContain("sent");                         // ...and never sent
    const pays = await paymentsOf(inv.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: "cash", status: "succeeded" });
    await page.waitForTimeout(4_000);
    expect((await paymentsOf(inv.id))[0].receipt_sent_at).toBeNull();
    const { data: msgs } = await db!.from("messages").select("id").eq("invoice_id", inv.id);
    expect(msgs ?? []).toHaveLength(0);
  });

  test("send takes the due date from the confirm, and it locks once sent", async ({ page }) => {
    const start = isoDay(4);
    const j = await job("Sendjob", { contractCents: 300_000, stage: "pre_start", startDate: start, invoices: [{ kind: "deposit", status: "draft", total: 150_000, due: null }] });
    const [inv] = await invoicesOf(j);
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);
    await card(page, j).getByRole("button", { name: /^Send deposit/ }).click();
    const sheet = page.getByRole("dialog", { name: "Send deposit invoice" });
    const due = sheet.getByLabel("Due date");
    await expect(due).toHaveValue(isoDay(3));                    // starts sooner than 7 days: the day before the start
    await due.fill(start);
    await expect(sheet).toContainText("falls on or after the start");
    await due.fill(isoDay(2));
    await sheet.getByRole("button", { name: /^Send \$1,500\.00 invoice to Sendjob/ }).click();
    await expect(sheet).toBeHidden({ timeout: 30_000 });

    const [after] = await invoicesOf(j);
    expect(after.number).toMatch(/^INV-/);
    expect(after.due_on).toBe(isoDay(2));
    expect(await rpcAs(staff!, "invoice_set_draft_due", { p_invoice_id: inv.id, p_due_on: isoDay(20) })).toBe("error:not_draft");
    expect((await invoicesOf(j))[0].due_on).toBe(isoDay(2));
  });

  test("the deposit percentage is computed by the server", async ({ page }) => {
    const j = await job("Depadj", { contractCents: 1_573_079, stage: "pre_start", startDate: isoDay(20), invoices: [{ kind: "deposit", status: "draft", total: 786_540, due: null }] });
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);
    await card(page, j).getByRole("button", { name: "change" }).click();
    await card(page, j).getByRole("button", { name: "30%" }).click();
    await expect(card(page, j)).toContainText("$4,719.24", { timeout: 20_000 });
    const [after] = await invoicesOf(j);
    expect(after.total_inc_cents).toBe(471_924);                 // round(1,573,079 × 30 / 100), in SQL
    const { data: lines } = await db!.from("invoice_lines").select("description").eq("invoice_id", after.id).eq("informational", false);
    expect((lines ?? []).map((l) => (l as { description: string }).description).join(" ")).toContain("30%");
  });

  test("change amount on a sent deposit is atomic", async () => {
    const j = await job("Change", { contractCents: 500_000, stage: "pre_start", startDate: isoDay(15), invoices: [{ kind: "deposit", status: "sent", total: 250_000, due: isoDay(5) }] });
    const [orig] = await invoicesOf(j);
    // Refused while a payment stands on it — and the original is untouched.
    await db!.from("payments").insert({ invoice_id: orig.id, amount_cents: 1_000, method: "bank_transfer", status: "succeeded", paid_on: isoDay(0) });
    expect(await rpcAs(staff!, "invoice_change_amount", { p_invoice_id: orig.id, p_mode: "percent", p_value: 20 })).toBe("error:has_payments");
    expect(await invoicesOf(j)).toEqual([orig]);
    await db!.from("payments").delete().eq("invoice_id", orig.id);
    // Then it voids and reissues in one go.
    const res = await rpcAs(staff!, "invoice_change_amount", { p_invoice_id: orig.id, p_mode: "percent", p_value: 20 });
    expect(res).toMatch(/^ok:[0-9a-f-]{36}$/);
    const all = await invoicesOf(j);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ id: orig.id, status: "void" });
    expect(all[0].voided_reason).toContain("replaced by a corrected invoice");
    expect(all[1]).toMatchObject({ kind: "deposit", status: "issued", total_inc_cents: 100_000 });
    expect(all[1].number).not.toBe(orig.number);
  });

  test("create deposit invoice on a booked job with none", async ({ page }) => {
    const j = await job("Noinv", { contractCents: 600_000, stage: "pre_start", startDate: isoDay(20), invoices: [] });
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`${PAGE}?q=${encodeURIComponent(j.address)}`);
    await card(page, j).getByRole("button", { name: "Create deposit invoice" }).click();
    await expect(page.getByTestId("pm-toast")).toContainText("Deposit invoice drafted.");
    const all = await invoicesOf(j);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "deposit", status: "draft" });
    expect(all[0].total_inc_cents).toBeGreaterThan(0);
  });
});
