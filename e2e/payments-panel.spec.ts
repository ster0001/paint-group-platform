import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, makePaymentsJob, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge, Step 7 — the job panel (docs/briefs/claude-code-brief-payments-merge.md §4.7).
 *
 *  · A row opens the panel over the page; the panel and the row show the same amounts.
 *  · Money in: every invoice with its payments under it; a draft's due date can change before it is sent.
 *  · Money out and profit: gross profit = job value ex GST − the listed costs, to the cent;
 *    a voided cost counts nowhere; the contractor invoice is the one on the Contractors block.
 *  · /invoicing/job/[id] is the same panel, full page — and the old "6b" placeholder text is gone.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PP7${Date.now().toString(36).slice(-5).toUpperCase()}`;
const made: PaymentsJob[] = [];
const ciIds: string[] = [];

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const panel = (page: Page) => page.getByTestId("pm-panel");

test.describe("Payments → the job panel — as staff", () => {
  test.setTimeout(240_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP) return;
    for (const j of made) await db.from("job_costs").delete().eq("work_order_id", j.f.workOrderId);
    if (ciIds.length) await db.from("contractor_invoices").delete().in("id", ciIds);
    await cleanupPaymentsJobs(db, made);
  });

  test("row → panel with the same figures; money in; profit to the cent; the full page is the same panel", async ({ page }) => {
    // $11,000 job ($10,000 ex GST), deposit 50% sent and paid, final drafted.
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Panel", {
      contractCents: 1_100_000, stage: "in_progress", startDate: isoDay(-2),
      invoices: [
        { kind: "deposit", status: "sent", total: 550_000, due: isoDay(-5), paid: true },
        { kind: "final", status: "draft", total: 550_000, due: null },
      ],
    });
    made.push(j);
    // The contractor's offer ($4,000 ex GST) lives on the work order's snapshot.
    const { data: wo, error: woErr } = await db!.from("work_orders").select("wo_snapshot").eq("id", j.f.workOrderId).single();
    if (woErr) throw woErr;
    const snap = { ...((wo as { wo_snapshot: Record<string, unknown> | null }).wo_snapshot ?? {}), contractorPaymentCents: 400_000 };
    const { error: snapErr } = await db!.from("work_orders").update({ wo_snapshot: snap }).eq("id", j.f.workOrderId);
    if (snapErr) throw snapErr;
    const { error: costErr } = await db!.from("job_costs").insert([
      { work_order_id: j.f.workOrderId, category: "labour", status: "approved", amount_ex_cents: 50_000, gst_cents: 0, description: `${stamp} timesheet` },
      { work_order_id: j.f.workOrderId, category: "materials", status: "approved", amount_ex_cents: 52_008, gst_cents: 5_201, description: `${stamp} Dulux` },
      { work_order_id: j.f.workOrderId, category: "scaffold", status: "paid", amount_ex_cents: 120_000, gst_cents: 12_000, description: `${stamp} scaffold` },
      { work_order_id: j.f.workOrderId, category: "materials", status: "void", amount_ex_cents: 77_777, gst_cents: 7_778, description: `${stamp} deleted` },
    ]);
    if (costErr) throw costErr;
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    const { data: ci, error: ciErr } = await db!.from("contractor_invoices").insert({
      work_order_id: j.f.workOrderId, contractor_id: cid, status: "submitted", number: `CI-${stamp}`,
      subtotal_ex_cents: 200_000, total_inc_cents: 200_000, claimed_ex_cents: 200_000, submitted_at: new Date().toISOString(),
    }).select("id").single();
    if (ciErr) throw ciErr;
    ciIds.push(ci!.id as string);

    // Expected profit: $10,000 − ($4,000 offer + $500 labour + $520.08 materials + $1,200 scaffold) = $3,779.92 (37.8%).
    const gp = 1_000_000 - (400_000 + 50_000 + 52_008 + 120_000);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/payments?view=table&q=${stamp}`);
    const tableRow = page.locator(".pm .tr", { hasText: j.address.split(",")[0] });
    await expect(tableRow).toBeVisible({ timeout: 30_000 });
    await tableRow.getByRole("link", { name: j.address }).click();

    // The panel opens over the view (the view's own query stays), with the row's figures.
    await expect(panel(page)).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get("q")).toBe(stamp);
    await expect(panel(page).locator(".three")).toContainText(money(1_100_000));
    await expect(panel(page).locator(".three")).toContainText(`Paid${money(550_000)}`);
    await expect(panel(page).locator(".three")).toContainText(`Still owing${money(550_000)}`);

    // Money in: both invoices, the payment under the deposit.
    const deposit = panel(page).locator(".inv", { hasText: "Deposit invoice" });
    await expect(deposit).toContainText("(50%)");
    await expect(deposit.locator(".pay")).toContainText(money(550_000));
    const final = panel(page).locator(".inv", { hasText: "Final invoice" });
    await expect(final).toContainText("Not sent yet");

    // A draft's due date changes before it's sent.
    const due = isoDay(10);
    await final.getByLabel("Due date").fill(due);
    await expect.poll(async () => {
      const { data } = await db!.from("invoices").select("due_on").eq("estimate_id", j.f.estimateId).eq("kind", "final").single();
      return (data as { due_on: string | null } | null)?.due_on;
    }, { timeout: 20_000 }).toBe(due);

    // Money out and profit.
    await panel(page).getByRole("link", { name: "Money out and profit" }).click();
    const profit = panel(page).getByTestId("pm-profit");
    await expect(profit).toContainText(money(gp), { timeout: 20_000 });
    await expect(profit).toContainText("37.8%");
    const sum = panel(page).locator(".sum");
    await expect(sum).toContainText(`Job value, excluding GST${money(1_000_000)}`);
    await expect(sum).toContainText(`Contractor: offer− ${money(400_000)}`);
    await expect(sum).toContainText(`Own painters− ${money(50_000)}`);
    await expect(sum).toContainText(`Materials− ${money(52_008)}`);         // the voided $777.77 counts nowhere
    await expect(sum).toContainText(`Other trades and costs− ${money(120_000)}`);
    await expect(sum).toContainText(`Total costs− ${money(622_008)}`);
    await expect(panel(page)).not.toContainText("No materials are recorded");
    await expect(panel(page).locator(".cost", { hasText: "Contractor invoices" })).toContainText(`CI-${stamp}`);

    // The contractor invoice is the one the Contractors block shows.
    await page.goto(`/invoicing/payments?tab=con&q=${stamp}`);
    await expect(page.locator(".pm .prow", { hasText: `CI-${stamp}` })).toContainText(money(200_000), { timeout: 30_000 });

    // The job's own page is the same panel — same profit, no old placeholder.
    await page.goto(`/invoicing/job/${j.f.estimateId}?jt=out`);
    await expect(panel(page).getByTestId("pm-profit")).toContainText(money(gp), { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText("arrive with 6b");
    await page.goto(`/invoicing/job/${j.f.estimateId}`);
    await expect(panel(page).locator(".inv")).toHaveCount(2);

    // No sideways scroll on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(panel(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  // Step 8a: a non-materials cost (rubbish, scaffold…) is approved and paid from the panel — the old Payables tab goes.
  test("a rubbish docket on the job: Approve, then ✓ Paid with Undo, from Money out", async ({ page }) => {
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Costrow", { contractCents: 550_000, stage: "in_progress", startDate: isoDay(-2), invoices: [] });
    made.push(j);
    const { data, error } = await db!.from("job_costs").insert({ work_order_id: j.f.workOrderId, category: "rubbish", status: "recorded", amount_ex_cents: 20_000, gst_cents: 2_000, description: `${stamp} skip bin` }).select("id").single();
    if (error) throw error;
    const id = (data as { id: string }).id;
    const status = async () => ((await db!.from("job_costs").select("status").eq("id", id).single()).data as { status: string }).status;

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/job/${j.f.estimateId}?jt=out`);
    const row = panel(page).getByTestId(`job-cost-item-${id}`);
    await expect(row).toContainText("To approve", { timeout: 30_000 });
    await row.getByRole("button", { name: "Approve" }).click();
    await expect.poll(status, { timeout: 20_000 }).toBe("approved");
    await expect(row.getByRole("button", { name: "✓ Paid" })).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "✓ Paid" }).click();
    await expect.poll(status, { timeout: 20_000 }).toBe("paid");
    await page.getByTestId("pm-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(status, { timeout: 20_000 }).toBe("approved");
  });

  // §6.3 (4/20 Cockatoo St): a final drafted while the deposit was still a draft charged the whole contract.
  test("a draft final follows the deposit: paying the draft deposit re-works it, and a stale one offers Redraft", async ({ page }) => {
    const finalOf = async (estimateId: string) => {
      const { data, error } = await db!.from("invoices").select("id, total_inc_cents").eq("estimate_id", estimateId).eq("kind", "final").eq("status", "draft").single();
      if (error) throw error;
      return data as { id: string; total_inc_cents: number };
    };
    // 1 · The trigger: final drafted while the $5,500 deposit is a draft → $11,000; the deposit is paid → $5,500.
    const j = await makePaymentsJob(db!, contractor!.email, stamp, "Redraft", {
      contractCents: 1_100_000, stage: "closed", startDate: isoDay(-20),
      invoices: [{ kind: "deposit", status: "draft", total: 550_000, due: null }],
    });
    made.push(j);
    const drafted = await db!.rpc("invoice_draft_final", { p_estimate_id: j.f.estimateId });
    expect(String(drafted.data ?? drafted.error?.message)).toMatch(/^ok:/);
    expect((await finalOf(j.f.estimateId)).total_inc_cents).toBe(1_100_000);

    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/job/${j.f.estimateId}`);
    const deposit = panel(page).locator('.inv[data-kind="deposit"]');
    await deposit.getByRole("button", { name: "Already paid" }).click();
    const sheet = page.getByRole("dialog", { name: "Record a payment" });
    await sheet.getByLabel("Amount received").fill("5500.00");
    await sheet.getByRole("button", { name: "Record payment" }).click();
    await expect.poll(async () => (await finalOf(j.f.estimateId)).total_inc_cents, { timeout: 20_000 }).toBe(550_000);
    await page.reload();
    await expect(panel(page).locator('.inv[data-kind="final"]')).toContainText(money(550_000));
    await expect(panel(page).getByTestId("stale-final")).toHaveCount(0);

    // 2 · A draft made before the trigger existed: the deposit was issued after it, nothing re-worked it.
    const k = await makePaymentsJob(db!, contractor!.email, stamp, "Stale", {
      contractCents: 1_100_000, stage: "closed", startDate: isoDay(-20),
      invoices: [
        { kind: "deposit", status: "sent", total: 550_000, due: isoDay(-10), paid: true },
        { kind: "final", status: "draft", total: 1_100_000, due: null },
      ],
    });
    made.push(k);
    const stale = await finalOf(k.f.estimateId);
    const { error: evErr } = await db!.from("invoice_events").insert({
      invoice_id: stale.id, type: "drafted", actor_kind: "system", meta: { auto: "final", total_inc_cents: 1_100_000, previously_invoiced_cents: 0 },
    });
    if (evErr) throw evErr;
    await page.goto(`/invoicing/job/${k.f.estimateId}`);
    const note = panel(page).getByTestId("stale-final");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await note.getByRole("button", { name: "Redraft" }).click();
    await expect.poll(async () => (await finalOf(k.f.estimateId)).total_inc_cents, { timeout: 20_000 }).toBe(550_000);
    await expect(panel(page).getByTestId("stale-final")).toHaveCount(0, { timeout: 20_000 });
  });
});
