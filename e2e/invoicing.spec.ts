import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn, test } from "./helpers";
import { melbourneDate } from "../lib/workorder/console";
import { addDays } from "../lib/scheduling/dates";

/**
 * Invoicing Step 2 — the §8 e2e, AS STAFF, in the real browser against the
 * live schema:
 *
 *   accept estimate → deposit draft appears on the job AND on the dashboard
 *   → issue → record bank payment → stage rail, money strip and dashboard
 *   row all update from data alone.
 *
 * Plus the §7.3 acceptance: an edit that moves a final draft off the ledger
 * raises the reconciliation banner, and both resolution paths write events
 * (that part probes for migration 20261113 and skips until it is live).
 *
 * The fixture accepts through the REAL accept_estimate RPC — the deposit
 * draft must appear without any page-specific write.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");

const ADDRESS = `77 Invoicing Test Ct, Melbourne ${process.pid}`;
const TOTAL = 1_850_000; // $18,500 inc GST
const DEPOSIT = 185_000; // 10%

let estimateId: string | null = null;
let depositInvoiceId: string | null = null;

test.describe.configure({ mode: "serial" });

test.describe("invoicing — accept → deposit → issue → pay", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the invoicing e2e");
  test.skip(!staff, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const sb = db!;
    const token = `inv2test${Math.abs(Date.now() % 1e10)}${process.pid}`;
    const { data: est, error } = await sb.from("estimates").insert({
      title: "Invoicing e2e",
      status: "sent",
      level_of_finish: 3,
      share_token: token,
      total_cents: TOTAL,
      builder_state: { blocks: [] },
      sent_snapshot: {
        totals: { totalCents: TOTAL },
        depositPct: 10,
        jobAddress: ADDRESS,
        jobTitle: "Exterior repaint",
        gstRatePct: 10,
        baseSubtotalCents: 1_681_818, // ex-GST net: 1681818 + 168182 GST = TOTAL
        areas: [{
          id: "a1", title: "Front elevation",
          descriptionHtml: "<p>Weatherboard, 12 × 2.6 m, 2 coats</p>",
          priceCents: 1_000_000, surfaces: [], photos: [],
        }],
        lineItems: [], options: [],
      },
    }).select("id").single();
    if (error) throw new Error(`fixture estimate: ${error.message}`);
    estimateId = (est as { id: string }).id;

    const { data: accepted, error: accErr } = await sb.rpc("accept_estimate", {
      p_token: token, p_name: "Invoicing E2E", p_options: [],
      p_total_cents: 0, p_deposit_cents: 0,
    });
    if (accErr) throw new Error(`accept: ${accErr.message}`);
    expect(accepted).toBe("accepted");

    // The migration gate: pre-invoicing schemas have no `kind` column.
    const probe = await sb.from("invoices")
      .select("id, kind, status, total_inc_cents")
      .eq("estimate_id", estimateId).single();
    test.skip(Boolean(probe.error),
      "needs migrations 20261111 + 20261112 (invoicing core) applied");
    const inv = probe.data as { id: string; kind: string; status: string; total_inc_cents: number };
    expect(inv.kind).toBe("deposit");
    expect(inv.status).toBe("draft");
    expect(inv.total_inc_cents).toBe(DEPOSIT);
    depositInvoiceId = inv.id;
  });

  test.afterAll(async () => {
    if (!db || !estimateId) return;
    // Stored PDFs first (best-effort), then the A2 teardown order: invoices
    // before estimates (RESTRICT); service_role may delete issued rows —
    // that is the one sanctioned exemption in the delete guard.
    const { data: invRows } = await db.from("invoices").select("id").eq("estimate_id", estimateId);
    for (const r of (invRows ?? []) as { id: string }[]) {
      const { data: files } = await db.storage.from("invoice-docs").list(r.id);
      if (files?.length) {
        await db.storage.from("invoice-docs").remove(files.map((f) => `${r.id}/${f.name}`));
      }
    }
    await db.from("invoices").delete().eq("estimate_id", estimateId);
    await db.from("work_orders").delete().eq("estimate_id", estimateId);
    await db.from("follow_ups").delete().eq("estimate_id", estimateId);
    await db.from("estimate_events").delete().eq("estimate_id", estimateId);
    await db.from("estimates").delete().eq("id", estimateId);
  });

  // Payments merge Step 7: /invoicing/job/[id] is the job panel — Money in
  // lists every invoice as a card (data-kind), its buttons on the card.
  async function openMoneyView(page: Page) {
    await page.goto(`/invoicing/job/${estimateId}`);
    await expect(page.getByRole("heading", { name: ADDRESS })).toBeVisible();
  }
  const invoiceCard = (page: Page, kind: string) => page.getByTestId("pm-panel").locator(`.inv[data-kind="${kind}"]`).first();
  async function requestPayment(page: Page, pct: number) {
    await page.getByRole("button", { name: "Request a payment" }).click();
    const sheet = page.getByRole("dialog", { name: "Request a payment" });
    await sheet.getByRole("button", { name: `${pct}%`, exact: true }).click();
    return sheet;
  }

  // Payments merge 8d: the list is Payments → All jobs, one row per job.
  const jobsRow = (page: Page) => page.locator(".pm .tr:not(.head):not(.grp)", { hasText: ADDRESS });
  const allJobs = `/invoicing?view=table&q=${encodeURIComponent(ADDRESS)}`;

  test("the deposit draft appears on Payments without a page-specific write", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(allJobs);
    const row = jobsRow(page);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Deposit");
    await expect(row).toContainText("$1,850.00");
  });

  test("and on the job money view — rail, strip and draft card from data alone", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMoneyView(page);
    const card = invoiceCard(page, "deposit");
    await expect(card).toContainText("Not sent yet");
    await expect(card).toContainText("$1,850.00");
    // Tom, 1 Oct: every figure on the job's payments page carries its cents.
    await expect(page.getByTestId("money-strip")).toContainText("Job total$18,500.00");
    await expect(page.getByTestId("money-strip")).toContainText("Still owing$18,500.00");
  });

  // Tom, 1 Oct: a job opened from Payments goes BACK to Payments — with the
  // view and search it was opened under. From PC Command it goes back to the job.
  test("the job panel's back link returns to where it was opened from", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(allJobs);
    await jobsRow(page).getByRole("link", { name: ADDRESS }).click();
    await expect(page).toHaveURL(/[?&]job=/, { timeout: 30_000 });
    const back = page.getByTestId("pm-panel").getByTestId("money-back");
    await expect(back).toHaveText(/Payments/);
    await back.click();
    // Closed: the same view and search, no job (wait for the navigation, not the old URL).
    await expect(page).toHaveURL((u) => u.pathname === "/invoicing" && !u.searchParams.has("job") && u.searchParams.get("view") === "table" && !!u.searchParams.get("q"), { timeout: 15_000 });

    // From PC Command (?from=/pc/wo/<id>): back to the job.
    const { data: wo } = await db!.from("work_orders").select("id").eq("estimate_id", estimateId!).single();
    await page.goto(`/invoicing/job/${estimateId}?from=${encodeURIComponent(`/pc/wo/${(wo as { id: string }).id}`)}`);
    await expect(page.getByTestId("money-back")).toHaveText(/the job/i, { timeout: 30_000 });

    // Opened bare, the panel goes back to Payments; the work order is its own link.
    await openMoneyView(page);
    await expect(page.getByTestId("money-back")).toHaveText(/Payments/);
    await expect(page.getByRole("link", { name: /^Work order / })).toHaveAttribute("href", /^\/pc\/wo\//);
  });

  // Tom, 17 Sep 2026: the deposit invoice lists every line item of the
  // accepted estimate — for information; the total stays the deposit.
  test("the deposit draft lists the accepted scope without it touching the total", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/invoicing/inv/${depositInvoiceId}`);
    await expect(page.getByText("Contract works — from accepted estimate")).toBeVisible();
    await expect(page.getByText("Front elevation")).toBeVisible();
    await expect(page.getByTestId("doc-total")).toHaveText("$1,850.00");

    const { data: lines, error } = await db!.from("invoice_lines")
      .select("source, informational, amount_ex_cents").eq("invoice_id", depositInvoiceId!).order("sort");
    expect(error).toBeNull();
    const rows = lines as { source: string; informational: boolean; amount_ex_cents: number }[];
    expect(rows.filter((l) => l.informational).map((l) => l.source)).toContain("estimate_snapshot");
    expect(rows.filter((l) => !l.informational)).toHaveLength(1); // the deposit's own money line

    // The customer sheet shows the same scope above "This invoice".
    const { data: inv } = await db!.from("invoices").select("token").eq("id", depositInvoiceId!).single();
    await page.goto(`/i/${(inv as { token: string }).token}?preview=1`);
    const sheet = page.getByTestId("invoice-sheet");
    await expect(sheet.getByText("Contract works — from your accepted estimate")).toBeVisible();
    await expect(sheet.getByText("Front elevation")).toBeVisible();
    await expect(sheet.getByTestId("total-inc")).toHaveText("$1,850.00");
  });

  test("issue allocates the number, and the database refuses edits after it", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMoneyView(page);
    await invoiceCard(page, "deposit").getByRole("button", { name: "Send", exact: true }).click();
    // The send sheet (Step 3): the due date, then the real send.
    await page.getByRole("dialog", { name: /^Send deposit invoice/ }).getByRole("button", { name: /^Send \$1,850\.00 invoice to/ }).click();
    // Issue also renders the PDF (a Chromium print of the token page) and
    // attempts the email — give the whole pipeline room on a cold dev server.
    await expect(invoiceCard(page, "deposit")).not.toContainText("Not sent yet", { timeout: 90_000 });

    const { data: issued } = await db!.from("invoices")
      .select("number, status, due_on").eq("id", depositInvoiceId!).single();
    expect((issued as { status: string }).status).toMatch(/^(issued|sent)$/);
    expect((issued as { number: string }).number).toMatch(/^INV-\d{4}$/);
    expect((issued as { due_on: string }).due_on).toBeTruthy();

    // Immutability is the DATABASE's promise, not the UI's: even the service
    // key cannot move money on an issued invoice.
    const mutate = await db!.from("invoices")
      .update({ amount_cents: 1 }).eq("id", depositInvoiceId!);
    expect(mutate.error?.message ?? "").toContain("invoice_immutable_after_issue");
  });

  test("a recorded bank payment pays the deposit and every surface follows", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMoneyView(page);
    const card = invoiceCard(page, "deposit");
    await card.getByRole("button", { name: "Cash or part" }).click();
    const sheet = page.getByRole("dialog", { name: "Record a payment" });
    await sheet.getByLabel("Amount received").fill("1850.00");
    // Tom, 1 Oct: the date the money arrived is typed in, defaulting to today
    // (Melbourne). Three days back here, so the saved row proves it was read.
    const paidOn = addDays(melbourneDate(new Date()), -3);
    await expect(sheet.getByLabel("Date received")).toHaveValue(melbourneDate(new Date()));
    await sheet.getByLabel("Date received").fill(paidOn);
    await sheet.getByRole("button", { name: "Record payment" }).click();

    // The card reads Paid, the strip's Paid and Still owing move — from data.
    await expect(card.locator(".tag")).toHaveText("Paid", { timeout: 15_000 });
    await expect(page.getByTestId("money-strip")).toContainText("Still owing$16,650.00");

    // Receipt allocated, payment row real, dated the day it was received.
    await expect.poll(async () => {
      const { data } = await db!.from("payments").select("receipt_number").eq("invoice_id", depositInvoiceId!).eq("status", "succeeded").single();
      return (data as { receipt_number: string | null } | null)?.receipt_number ?? "";
    }, { timeout: 30_000 }).toMatch(/^RCT-\d{4}$/);
    const { data: pay } = await db!.from("payments")
      .select("receipt_number, status, method, paid_on").eq("invoice_id", depositInvoiceId!).single();
    expect((pay as { paid_on: string }).paid_on).toBe(paidOn);

    // And the job's row on Payments reads the deposit paid; the aged bar is there.
    await page.goto(allJobs);
    await expect(jobsRow(page)).toContainText("✓ Paid", { timeout: 30_000 });
    await expect(page.getByTestId("aged-buckets")).toBeVisible();
  });

  test("request payment drafts a 25% progress claim, computed server-side", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMoneyView(page);
    const sheet = await requestPayment(page, 25);
    await expect(sheet.getByTestId("request-preview")).toHaveText("$4,625.00");
    await sheet.getByRole("button", { name: "Draft the invoice" }).click();
    await expect(invoiceCard(page, "progress")).toContainText("Not sent yet", { timeout: 15_000 });
    const { data: prog } = await db!.from("invoices")
      .select("kind, status, total_inc_cents").eq("estimate_id", estimateId!)
      .eq("kind", "progress").single();
    expect((prog as { total_inc_cents: number }).total_inc_cents).toBe(462_500);
    expect((prog as { status: string }).status).toBe("draft");
  });

  test("an off-ledger edit raises the reconciliation banner; both paths write events", async ({ page }) => {
    // The §7.3 editor RPCs land with migration 20261113 — probe, don't hope.
    const probe = await db!.rpc("invoice_final_drift_staff", {
      p_invoice_id: "00000000-0000-0000-0000-000000000000",
    });
    test.skip(
      Boolean(probe.error && /could not find|does not exist|schema cache/i.test(probe.error.message)),
      "needs migration 20261113 (invoice draft editing) applied",
    );

    await signIn(page, staff!, /\/(home|estimates)/);

    // First: the mockup's deposit-style amend, on the progress draft — the
    // inc-anchored "Amend the amount" path (invoice_set_draft_total).
    const { data: progRow } = await db!.from("invoices")
      .select("id").eq("estimate_id", estimateId!).eq("kind", "progress").single();
    await page.goto(`/invoicing/inv/${(progRow as { id: string }).id}`);
    await page.getByRole("button", { name: "Amend the amount" }).click();
    await page.getByTestId("amend-total").fill("5000.00");
    await page.getByRole("button", { name: "Save new total" }).click();
    await expect(page.getByTestId("doc-total")).toHaveText("$5,000.00", { timeout: 15_000 });

    await openMoneyView(page);
    await page.getByRole("button", { name: "Invoice in full" }).click();
    await expect(invoiceCard(page, "final")).toBeVisible({ timeout: 15_000 });
    await invoiceCard(page, "final").getByRole("link", { name: "Check invoice" }).click();
    await expect(page.getByTestId("recon-line")).toContainText("Reconciles to the job ledger");

    // Move a line $100 off the ledger — the banner must appear.
    await page.locator(".line .edit").first().click();
    const amount = page.getByTestId("line-amount");
    const current = Number(await amount.inputValue());
    await amount.fill(String(current + 100));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("reconciliation-banner")).toBeVisible({ timeout: 15_000 });

    // Path 1 — keep as one-off adjustment: recorded, and the recon line rests.
    page.once("dialog", (d) => d.accept("price honoured from the walkthrough"));
    await page.getByRole("button", { name: "Keep as one-off adjustment" }).click();
    await expect(page.getByTestId("recon-line")).toContainText("one-off adjustment", { timeout: 15_000 });

    // Move it again — the banner returns (a stale decision never hides drift).
    await page.locator(".line .edit").first().click();
    await page.getByTestId("line-amount").fill(String(current + 300));
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("reconciliation-banner")).toBeVisible({ timeout: 15_000 });

    // Path 2 — record as variation: the ledger moves, the document reconciles.
    page.once("dialog", (d) => d.accept("Extra prep found at the front door"));
    await page.getByRole("button", { name: "Record as variation" }).click();
    await expect(page.getByTestId("recon-line")).toContainText("Reconciles to the job ledger", { timeout: 15_000 });

    // Both decisions are events; the variation is a real override row.
    const { data: finalInv } = await db!.from("invoices")
      .select("id").eq("estimate_id", estimateId!).eq("kind", "final").single();
    const { data: events } = await db!.from("invoice_events")
      .select("type, meta").eq("invoice_id", (finalInv as { id: string }).id);
    const decisions = (events as { type: string; meta: { what?: string; decision?: string } }[])
      .filter((e) => e.type === "amended" && e.meta.what === "reconcile_decision")
      .map((e) => e.meta.decision);
    expect(decisions).toContain("one_off_adjustment");
    expect(decisions).toContain("recorded_as_variation");

    const { data: wo } = await db!.from("work_orders").select("id").eq("estimate_id", estimateId!).single();
    const { data: variation } = await db!.from("wo_variations")
      .select("override, status, price_cents").eq("work_order_id", (wo as { id: string }).id).single();
    expect((variation as { override: boolean }).override).toBe(true);
    expect((variation as { status: string }).status).toBe("customer_approved");
  });

  // ---- Step 3: PDF, token view, view tracking ------------------------------

  async function step3Ready() {
    const probe = await db!.rpc("invoice_by_token", { p_token: "probe-nonsense-token" });
    return !(probe.error && /could not find|does not exist|schema cache/i.test(probe.error.message));
  }

  test("the token link renders exactly one invoice, and only issued ones", async ({ browser }) => {
    test.skip(!(await step3Ready()), "needs migration 20261114 (invoice pdf + token) applied");

    const { data } = await db!.from("invoices")
      .select("id, token, number, status, kind").eq("estimate_id", estimateId!);
    const rows = data as { id: string; token: string; number: string | null; status: string; kind: string }[];
    const deposit = rows.find((r) => r.kind === "deposit")!;
    const others = rows.filter((r) => r.id !== deposit.id && r.number);

    // A fresh, signed-out browser — the customer.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/i/${deposit.token}`);
    await expect(page.getByTestId("invoice-sheet")).toBeVisible();
    await expect(page.getByText("TAX INVOICE")).toBeVisible();
    await expect(page.getByTestId("invoice-number")).toHaveText(deposit.number!);
    await expect(page.getByTestId("total-inc")).toHaveText("$1,850.00");
    await expect(page.getByTestId("gst-amount")).toHaveText("$168.18");
    // Tom, 20 Oct: invoice date and due date on the document — the deposit is
    // PAID by now, and the due date stays on the paper after payment.
    await expect(page.locator(".doctype .dates")).toContainText(/Issued \d{1,2} \w+ \d{4}/);
    await expect(page.locator(".doctype .dates")).toContainText(/Due \d{1,2} \w+ \d{4}/);

    // Exactly ONE invoice's payload: no other invoice's number, and none of
    // the codebase's internal money fields, anywhere in the response.
    const content = await page.content();
    for (const o of others) expect(content).not.toContain(o.number!);
    for (const leak of ["marginCents", "margin_cents", "contractorPaymentCents", "contractor_delta_cents"]) {
      expect(content).not.toContain(leak);
    }

    // The customer visit wrote the viewed event.
    const { data: events } = await db!.from("invoice_events")
      .select("type, actor_kind").eq("invoice_id", deposit.id).eq("type", "viewed");
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);

    // An unknown token is a plain 404, never a 403.
    await page.goto("/i/this-token-does-not-exist");
    await expect(page.getByText("This invoice link isn't active")).toBeVisible();
    await ctx.close();
  });

  test("the PDF exists, downloads, and is a real PDF", async ({ page }) => {
    test.skip(!(await step3Ready()), "needs migration 20261114 (invoice pdf + token) applied");
    test.setTimeout(180_000);

    await signIn(page, staff!, /\/(home|estimates)/);
    const res = await page.request.get(`/invoicing/inv/${depositInvoiceId}/pdf`, { timeout: 120_000 });
    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.subarray(0, 4).toString()).toBe("%PDF");
    expect(body.length).toBeGreaterThan(10_000);

    // Immutable: the stored path never changes once written.
    const { data: first } = await db!.from("invoices").select("pdf_path").eq("id", depositInvoiceId!).single();
    const res2 = await page.request.get(`/invoicing/inv/${depositInvoiceId}/pdf`);
    expect(res2.ok()).toBeTruthy();
    const { data: second } = await db!.from("invoices").select("pdf_path").eq("id", depositInvoiceId!).single();
    expect((second as { pdf_path: string }).pdf_path).toBe((first as { pdf_path: string }).pdf_path);

    // A second attach attempt is refused by the database, not by politeness.
    const again = await db!.rpc("invoice_attach_pdf", {
      p_invoice_id: depositInvoiceId!, p_path: "somewhere/else.pdf",
    });
    expect(String(again.data)).toBe("error:pdf_immutable");
  });

  // ---- Step 4: the Pay box, card payments OFF ------------------------------
  // Card payments are a Settings switch (Tom, 4 Oct 2026), off by default.
  // Off, the customer's Pay button opens the bank-details box alone, the
  // checkout route refuses with a friendly line, and a webhook with no
  // secret answers 503 rather than pretending. Test-card e2e runs on C1.

  // Tom, 17 Sep 2026: a customer who pays by bank transfer before we have sent
  // the invoice must not force a send. The 25% progress claim above is still a
  // draft — record the money against it and the server issues it on the way.
  test("a payment recorded on a DRAFT issues it silently — number allocated, nothing sent", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMoneyView(page);
    const card = invoiceCard(page, "progress");
    await expect(card).toContainText("Not sent yet");
    // Pay whatever the draft says today — the reconciliation test above may
    // have amended it — so this is a payment in full, not a part payment.
    const { data: before } = await db!.from("invoices")
      .select("total_inc_cents").eq("estimate_id", estimateId!).eq("kind", "progress").single();
    const owed = (before as { total_inc_cents: number }).total_inc_cents;
    await card.getByRole("button", { name: "Already paid" }).click();
    const sheet = page.getByRole("dialog", { name: "Record a payment" });
    await sheet.getByLabel("Amount received").fill((owed / 100).toFixed(2));
    await sheet.getByRole("button", { name: "Record payment" }).click();
    // Paid in full: the card's tag says so and nothing is left to pay on it.
    await expect(card.locator(".tag")).toHaveText("Paid", { timeout: 15_000 });
    await expect(card).not.toContainText("still to pay");
    // The card carries the invoice date and the due date (Tom, 20 Oct).
    await expect(card.getByTestId("invoice-dates")).toContainText(/Invoice date \d{1,2} \w{3}/);
    await expect(card.getByTestId("invoice-dates")).toContainText(/Due \d{1,2} \w{3}/);

    const { data: prog, error } = await db!.from("invoices")
      .select("id, number, status, issued_on").eq("estimate_id", estimateId!)
      .eq("kind", "progress").single();
    expect(error).toBeNull();
    const row = prog as { id: string; number: string; status: string; issued_on: string };
    expect(row.status).toBe("paid");
    expect(row.number).toMatch(/^INV-\d{4}$/);
    expect(row.issued_on).toBeTruthy();

    // The events tell the story: issued, then paid — and never sent.
    const { data: events } = await db!.from("invoice_events")
      .select("type, meta").eq("invoice_id", row.id).order("created_at");
    const types = ((events ?? []) as { type: string; meta: { paid_before_send?: boolean } }[]);
    expect(types.map((e) => e.type)).toEqual(expect.arrayContaining(["issued", "payment_received"]));
    expect(types.map((e) => e.type)).not.toContain("sent");
    expect(types.find((e) => e.type === "payment_received")?.meta.paid_before_send).toBe(true);
  });

  test("the customer's Pay button opens the bank-details box — amount, bank, invoice number as reference", async ({ page, browser }) => {
    // Tom, 4 Oct 2026: card payments are OFF unless Settings turns them on.
    // Pin the switch off for this test so the box is bank transfer alone,
    // whatever the server's Stripe env says.
    const { data: inv } = await db!.from("settings").select("value").eq("key", "invoicing").maybeSingle();
    const prior = (inv?.value as Record<string, unknown> | null) ?? {};
    await db!.from("settings").upsert(
      { key: "invoicing", value: { ...prior, cardPaymentsEnabled: false } }, { onConflict: "key" },
    );

    // The first progress claim was paid in full by the test above, so draft a
    // SECOND one as staff and issue it: an OPEN invoice with a balance.
    await signIn(page, staff!, /\/(home|estimates)/);
    await openMoneyView(page);
    const sheet = await requestPayment(page, 25);
    await sheet.getByRole("button", { name: "Draft the invoice" }).click();
    await expect.poll(async () => (await db!.from("invoices").select("id", { count: "exact", head: true })
      .eq("estimate_id", estimateId!).eq("kind", "progress").eq("status", "draft")).count, { timeout: 15_000 }).toBe(1);
    const { data: prog, error: progErr } = await db!.from("invoices")
      .select("id, token, number").eq("estimate_id", estimateId!).eq("kind", "progress")
      .eq("status", "draft").single();
    expect(progErr).toBeNull();
    const progress = prog as { id: string; token: string; number: string | null };
    const issued = await rpcAs(staff!, "invoice_issue", { p_invoice_id: progress.id });
    expect(String(issued)).toContain("ok");
    const token = progress.token;
    const { data: after } = await db!.from("invoices")
      .select("number, total_inc_cents").eq("id", progress.id).single();
    const row = after as { number: string; total_inc_cents: number };
    const owed = "$" + (row.total_inc_cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 });

    const ctx = await browser.newContext();
    const customer = await ctx.newPage();
    await customer.goto(`/i/${token}`);
    await expect(customer.getByTestId("invoice-sheet")).toBeVisible();

    // On screen: no static box, one Pay button carrying the balance.
    await expect(customer.getByText("How to pay — bank transfer")).toHaveCount(0);
    const payButton = customer.getByTestId("pay-button");
    await expect(payButton).toHaveText(`Pay ${owed}`);
    await expect(customer.getByTestId("pay-dialog")).toBeHidden();

    await payButton.click();
    const dialog = customer.getByTestId("pay-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Payment due");
    await expect(customer.getByTestId("pay-dialog-amount")).toHaveText(owed);
    await expect(dialog).toContainText("Bank transfer");
    await expect(dialog).toContainText("Account name");
    await expect(customer.getByTestId("pay-dialog-reference")).toHaveText(row.number);
    // Card payments are off: no card option in the box.
    await expect(customer.getByTestId("pay-panel")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();

    // The PDF print keeps the static box — a printout has nothing to press.
    await customer.goto(`/i/${token}?print=1`);
    await expect(customer.getByText("How to pay — bank transfer")).toBeVisible();
    await expect(customer.getByTestId("pay-button")).toHaveCount(0);

    // The checkout route refuses while the switch is off, and the webhook
    // answers honestly when it has no secret.
    const checkout = await customer.request.post(`/i/${token}/checkout`);
    expect(checkout.status()).toBe(503);
    expect(await checkout.text()).toContain("bank transfer");
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      const webhook = await customer.request.post("/api/webhooks/stripe", { data: "{}" });
      expect(webhook.status()).toBe(503);
    }
    await ctx.close();
  });

  test("Settings → Invoicing has the one button that adds or removes card payments", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/settings#invoicing");
    const section = page.getByTestId("card-payments-settings");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("card-payments-state")).toHaveText("off");
    await expect(page.getByTestId("card-payments-toggle")).toHaveText("Add card payments");

    await page.getByTestId("card-payments-toggle").click();
    await expect(page.getByTestId("card-payments-state")).toHaveText("on");
    await expect(page.getByTestId("card-payments-toggle")).toHaveText("Remove card payments");
    const { data: on } = await db!.from("settings").select("value").eq("key", "invoicing").single();
    expect((on?.value as { cardPaymentsEnabled?: boolean }).cardPaymentsEnabled).toBe(true);

    // Survives a reload (it is the saved value, not the button's memory).
    await page.reload();
    await expect(page.getByTestId("card-payments-state")).toHaveText("on");

    await page.getByTestId("card-payments-toggle").click();
    await expect(page.getByTestId("card-payments-state")).toHaveText("off");
    const { data: off } = await db!.from("settings").select("value").eq("key", "invoicing").single();
    expect((off?.value as { cardPaymentsEnabled?: boolean }).cardPaymentsEnabled).toBe(false);
  });
});
