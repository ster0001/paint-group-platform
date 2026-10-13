import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { contractorIdForEmail, rpcAs, serviceClient } from "./fixtures/woLoop";
import { cleanupPaymentsJobs, isoDay, type PaymentsJob } from "./fixtures/paymentsJobs";

/**
 * Payments merge Step 8 — the full loop, in real roles (brief §5 Step 8):
 *
 *   accept → deposit draft → adjust to 30% → send → message → one-press paid → undo →
 *   paid again → job under way → supplier invoice confirmed → contractor invoice
 *   approved and paid → final sent → paid in cash with notification off → job leaves
 *   the active views → profit on the panel reconciles.
 *
 * The CUSTOMER accepts in their own (anonymous) session through the function the
 * estimate page calls, and reads the final invoice by its token. The CONTRACTOR
 * submits their invoice in their own session. STAFF drive every Payments step in
 * the browser. Moving the job's stage and drafting at sign-off belong to other
 * modules' flows, so the fixture does those.
 *
 * $11,000 job ($10,000 ex GST). Deposit 30% = $3,300; final = $7,700.
 * Costs: contractor offer $4,000 ex GST; supplier invoice $550 inc ($500 ex).
 * Gross profit = $10,000 − $4,500 = $5,500 (55%).
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();
const stamp = `PL8${Date.now().toString(36).slice(-5).toUpperCase()}`;
const ADDRESS = `${stamp} Loop St, Testville`;
const TOTAL = 1_100_000;
let job: PaymentsJob | null = null;
const intakeIds: string[] = [];
const DOC = `bills/e2e/${stamp}.pdf`;
// The smallest PDF a browser will open — a supplier invoice is never a cost without its document.
const PDF = "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
const ciIds: string[] = [];

const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test.describe("Payments — the full loop, in real roles", () => {
  test.setTimeout(420_000);
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.afterAll(async () => {
    if (!db || process.env.E2E_KEEP || !job) return;
    if (ciIds.length) {
      await db.from("wo_events").delete().in("meta->>contractor_invoice_id", ciIds);
      await db.from("contractor_invoices").delete().in("id", ciIds);
    }
    await db.from("job_costs").delete().eq("work_order_id", job.f.workOrderId);
    if (intakeIds.length) await db.from("cost_intake").delete().in("id", intakeIds);
    await cleanupPaymentsJobs(db, [job]);
    await db.storage.from("cost-docs").remove([DOC]);
  });

  test("accept → 30% deposit → send → message → paid, undo, paid → supplier → contractor → final → cash → off the active views → profit", async ({ page, browser }) => {
    const sb = db!;
    const invoiceOf = async (kind: string) => {
      const { data, error } = await sb.from("invoices").select("id, status, total_inc_cents, token").eq("estimate_id", job!.f.estimateId).eq("kind", kind).neq("status", "void").order("created_at", { ascending: false }).limit(1).single();
      if (error) throw error;
      return data as { id: string; status: string; total_inc_cents: number; token: string };
    };
    const panel = page.getByTestId("pm-panel");

    // ── The customer accepts, in their own session. The deposit is drafted at 50% (the standard). ──
    const token = `pl8${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const { data: est, error: estErr } = await sb.from("estimates").insert({
      title: "Payments full loop", status: "sent", level_of_finish: 3, share_token: token, total_cents: TOTAL,
      // The chat reply (Message) notifies this contact: an .invalid address, no phone — nothing can be delivered.
      builder_state: { blocks: [], contact: { first_name: "Loop", email: `loop.${stamp.toLowerCase()}@payments-e2e.invalid`, phone: "" } },
      sent_snapshot: {
        totals: { totalCents: TOTAL }, depositPct: 50, jobAddress: ADDRESS, jobTitle: "Exterior repaint", gstRatePct: 10,
        contactEmail: `loop.${stamp.toLowerCase()}@payments-e2e.invalid`, baseSubtotalCents: 1_000_000,
        areas: [{ id: "a1", title: "Front", descriptionHtml: "<p>Weatherboard</p>", priceCents: 1_000_000, surfaces: [], photos: [] }],
        lineItems: [], options: [],
      },
    }).select("id").single();
    if (estErr) throw estErr;
    const estimateId = (est as { id: string }).id;
    const accepted = await anon().rpc("accept_estimate", { p_token: token, p_name: "Loop Customer", p_options: [], p_total_cents: 0, p_deposit_cents: 0 });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toBe("accepted");
    const { data: wo, error: woErr } = await sb.from("work_orders").select("id, wo_snapshot").eq("estimate_id", estimateId).single();
    if (woErr) throw woErr;
    const workOrderId = (wo as { id: string }).id;
    job = { f: { estimateId, workOrderId, surfaces: [] }, label: "Loop", address: ADDRESS };
    expect((await invoiceOf("deposit")).total_inc_cents).toBe(550_000);

    // Booked (the offer flow is another module's): our contractor, starting in five days, $4,000 ex GST.
    const cid = (await contractorIdForEmail(sb, contractor!.email))!;
    const snap = { ...((wo as { wo_snapshot: Record<string, unknown> | null }).wo_snapshot ?? {}), contractorPaymentCents: 400_000, jobAddress: ADDRESS };
    const booked = await sb.from("work_orders").update({ contractor_id: cid, stage: "pre_start", start_date: isoDay(5), contractor_payment_cents: 400_000, wo_snapshot: snap }).eq("id", workOrderId);
    if (booked.error) throw booked.error;

    // ── Staff: the deposit to 30%, then Send. ──
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/job/${estimateId}`);
    const deposit = panel.locator('.inv[data-kind="deposit"]');
    await deposit.getByRole("button", { name: "30%", exact: true }).click();
    await expect.poll(async () => (await invoiceOf("deposit")).total_inc_cents, { timeout: 20_000 }).toBe(330_000);
    await page.reload();
    await deposit.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("dialog", { name: /^Send deposit invoice/ }).getByRole("button", { name: /^Send \$3,300\.00 invoice to/ }).click();
    await expect.poll(async () => (await invoiceOf("deposit")).status, { timeout: 90_000 }).toMatch(/^(issued|sent|viewed)$/);

    // ── Message: the deposit reminder, written for staff, posted only on Send. ──
    await page.reload();
    await panel.locator(".big-act").getByRole("button", { name: "Message" }).click();
    const dock = page.getByTestId("staff-dock");
    await expect(dock).toHaveAttribute("data-open", "1", { timeout: 20_000 });
    await expect(dock.getByTestId("dock-input")).toHaveValue(/Hello Loop/, { timeout: 20_000 });
    await dock.getByTestId("dock-send").click();
    await expect.poll(async () => (await sb.from("invoice_events").select("id", { count: "exact", head: true }).eq("type", "nudge_sent").eq("invoice_id", (await invoiceOf("deposit")).id)).count, { timeout: 20_000 }).toBe(1);

    // ── One press: paid. Undo. Paid again. ──
    const pays = async () => ((await sb.from("payments").select("status").eq("invoice_id", (await invoiceOf("deposit")).id).order("created_at")).data ?? []).map((p) => (p as { status: string }).status);
    await page.goto(`/invoicing/job/${estimateId}`);
    await panel.locator(".big-act").getByRole("button", { name: /^✓ Paid \$3,300\.00/ }).click();
    await expect.poll(pays, { timeout: 20_000 }).toEqual(["succeeded"]);
    await page.getByTestId("pm-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(pays, { timeout: 20_000 }).toEqual(["reversed"]);
    await page.reload();
    await panel.locator(".big-act").getByRole("button", { name: /^✓ Paid \$3,300\.00/ }).click();
    await expect.poll(pays, { timeout: 20_000 }).toEqual(["reversed", "succeeded"]);
    await expect.poll(async () => (await invoiceOf("deposit")).status, { timeout: 20_000 }).toBe("paid");

    // ── The job is under way; a supplier invoice arrives for it and is confirmed. ──
    expect((await sb.from("work_orders").update({ stage: "in_progress" }).eq("id", workOrderId)).error).toBeNull();
    const up = await sb.storage.from("cost-docs").upload(DOC, new Blob([PDF], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    if (up.error) throw up.error;
    const { data: doc, error: docErr } = await sb.from("cost_intake").insert({
      source: "email", message_id: `e2e-${stamp}-loop`, raw_doc_path: DOC, from_email: `invoices@${stamp.toLowerCase()}.invalid`, subject: "Invoice",
      extract_status: "extracted", match_reason: "address", status: "pending", proposed_wo_id: workOrderId,
      extracted: { supplier: `${stamp} Paints`, invoice_no: `${stamp}-1`, invoice_date: isoDay(-1), total_cents: 55_000, gst_cents: 5_000, order_ref: ADDRESS },
    }).select("id").single();
    if (docErr) throw docErr;
    intakeIds.push((doc as { id: string }).id);
    await page.goto(`/invoicing?tab=mat`);
    const supplierRow = page.locator(`.pm [data-testid=pm-materials] .prow[data-mat="intake:${(doc as { id: string }).id}"]`);
    await supplierRow.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(async () => ((await sb.from("job_costs").select("status, category, amount_ex_cents").eq("intake_id", (doc as { id: string }).id).maybeSingle()).data), { timeout: 20_000 })
      .toEqual({ status: "approved", category: "materials", amount_ex_cents: 50_000 });

    // ── The contractor's invoice: drafted at sign-off, submitted in THEIR session, approved and paid by staff. ──
    const drafted = await sb.rpc("contractor_invoice_draft", { p_work_order_id: workOrderId });
    expect(String(drafted.data ?? drafted.error?.message)).toMatch(/^ok:/);
    const ciId = String(drafted.data).slice(3);
    ciIds.push(ciId);
    expect(String(await rpcAs(contractor!, "contractor_invoice_submit", { p_id: ciId }))).toMatch(/^ok/);
    await page.goto(`/invoicing?tab=con&q=${stamp}`);
    const ciRow = page.locator(`.pm .prow[data-ci="${ciId}"]`);
    await ciRow.getByRole("button", { name: "Approve" }).click();
    await expect.poll(async () => ((await sb.from("contractor_invoices").select("status").eq("id", ciId).single()).data as { status: string }).status, { timeout: 20_000 }).toBe("approved");
    await page.reload();
    await ciRow.getByRole("button", { name: /^✓ Paid/ }).click();
    await expect.poll(async () => ((await sb.from("contractor_invoices").select("status").eq("id", ciId).single()).data as { status: string }).status, { timeout: 20_000 }).toBe("paid");

    // ── Signed off: the final is drafted ($11,000 − $3,300) and sent from its card. ──
    expect((await sb.from("work_orders").update({ stage: "closed" }).eq("id", workOrderId)).error).toBeNull();
    expect(String((await sb.rpc("invoice_draft_final", { p_estimate_id: estimateId })).data)).toMatch(/^ok:/);
    expect((await invoiceOf("final")).total_inc_cents).toBe(770_000);
    await page.goto(`/invoicing/job/${estimateId}`);
    const final = panel.locator('.inv[data-kind="final"]');
    await final.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("dialog", { name: /^Send final invoice/ }).getByRole("button", { name: /^Send \$7,700\.00 invoice to/ }).click();
    await expect.poll(async () => (await invoiceOf("final")).status, { timeout: 90_000 }).toMatch(/^(issued|sent|viewed)$/);

    // ── Paid in cash, with the notification switched off. ──
    await page.reload();
    await final.getByRole("button", { name: "Cash or part" }).click();
    const sheet = page.getByRole("dialog", { name: "Record a payment" });
    await sheet.getByRole("button", { name: "Cash", exact: true }).click();
    const notify = sheet.getByRole("switch", { name: "Send notification of payment" });
    if ((await notify.getAttribute("aria-checked")) === "true") await notify.click();
    await expect(notify).toHaveAttribute("aria-checked", "false");
    await sheet.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByTestId("pm-toast")).toContainText("No email sent.", { timeout: 20_000 });
    await expect.poll(async () => (await invoiceOf("final")).status, { timeout: 20_000 }).toBe("paid");
    const { data: cash } = await sb.from("payments").select("method, status").eq("invoice_id", (await invoiceOf("final")).id).single();
    expect(cash).toEqual({ method: "cash", status: "succeeded" });

    // ── Paid in full: off the active views, back only under Show paid. ──
    await page.goto(`/invoicing?q=${stamp}`);
    await expect(page.getByTestId("pm-headline")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".pm .job", { hasText: ADDRESS })).toHaveCount(0);
    await page.goto(`/invoicing?view=table&q=${stamp}`);
    await expect(page.locator(".pm .tr", { hasText: ADDRESS })).toHaveCount(0);
    await page.goto(`/invoicing?view=table&paid=1&q=${stamp}`);
    await expect(page.locator(".pm .tr", { hasText: ADDRESS })).toBeVisible({ timeout: 30_000 });

    // ── The panel's profit reconciles: $10,000 − ($4,000 contractor + $500 materials) = $5,500. ──
    await page.goto(`/invoicing/job/${estimateId}?jt=out`);
    const profit = panel.getByTestId("pm-profit");
    await expect(profit).toContainText(money(550_000), { timeout: 30_000 });
    await expect(profit).toContainText("55%");
    await expect(panel.locator(".sum")).toContainText(`Total costs− ${money(450_000)}`);
    await expect(panel.getByTestId("money-strip")).toContainText(`Still owing${money(0)}`);

    // ── The customer reads the final by its link: paid. ──
    const customer = await (await browser.newContext()).newPage();
    await customer.goto(`/i/${(await invoiceOf("final")).token}`);
    await expect(customer.getByTestId("invoice-sheet")).toBeVisible({ timeout: 30_000 });
    await expect(customer.getByTestId("invoice-sheet")).toContainText(/paid/i);
  });
});
