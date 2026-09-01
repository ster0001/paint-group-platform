import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcAs, serviceClient } from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";

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

  async function openMoneyView(page: Page) {
    await page.goto(`/invoicing/job/${estimateId}`);
    await expect(page.getByRole("heading", { name: ADDRESS })).toBeVisible();
  }

  test("the deposit draft appears on the dashboard without a page-specific write", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await page.goto("/invoicing?f=draft");
    const row = page.locator(".r", { hasText: ADDRESS });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Draft (unnumbered)");
    await expect(row).toContainText("Deposit");
    await expect(row).toContainText("$1,850");
  });

  test("and on the job money view — rail, strip and draft card from data alone", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await openMoneyView(page);
    await expect(page.getByTestId("deposit-draft-card")).toBeVisible();
    await expect(page.getByTestId("stage-rail").locator(".stage").first()).toHaveClass(/draft/);
    await expect(page.getByTestId("strip-balance")).toHaveText("$18,500");
  });

  test("issue allocates the number, and the database refuses edits after it", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await openMoneyView(page);
    await page.getByTestId("deposit-draft-card").getByRole("button", { name: "Issue & send" }).click();
    // The send sheet (8790fd8, 25 Aug): note + channel, then the real send —
    // the sheet's own confirm carries the same label, hence .last().
    await page.getByRole("button", { name: "Issue & send" }).last().click();
    // Issue now also renders the PDF (a Chromium print of the token page) and
    // attempts the email — give the whole pipeline room on a cold dev server.
    await expect(page.getByTestId("deposit-draft-card")).toHaveCount(0, { timeout: 90_000 });

    const { data: issued } = await db!.from("invoices")
      .select("number, status, due_on").eq("id", depositInvoiceId!).single();
    expect((issued as { status: string }).status).toBe("issued");
    expect((issued as { number: string }).number).toMatch(/^INV-\d{4}$/);
    expect((issued as { due_on: string }).due_on).toBeTruthy();

    // Immutability is the DATABASE's promise, not the UI's: even the service
    // key cannot move money on an issued invoice.
    const mutate = await db!.from("invoices")
      .update({ amount_cents: 1 }).eq("id", depositInvoiceId!);
    expect(mutate.error?.message ?? "").toContain("invoice_immutable_after_issue");
  });

  test("a recorded bank payment pays the deposit and every surface follows", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await openMoneyView(page);
    await page.getByRole("button", { name: "Invoices" }).click();
    const card = page.getByTestId("invoice-card-deposit");
    await card.getByRole("button", { name: "Record payment" }).click();
    await page.getByTestId("record-amount").fill("1850.00");
    await page.getByRole("button", { name: /^Record \$/ }).click();

    // The rail flips to paid, the strip's Paid and Balance move — from data.
    await expect(page.getByTestId("stage-rail").locator(".stage").first()).toHaveClass(/paid/, { timeout: 15_000 });
    await expect(page.getByTestId("strip-balance")).toHaveText("$16,650");

    // Receipt allocated, payment row real.
    const { data: pay } = await db!.from("payments")
      .select("receipt_number, status, method").eq("invoice_id", depositInvoiceId!).single();
    expect((pay as { receipt_number: string }).receipt_number).toMatch(/^RCT-\d{4}$/);

    // And the dashboard row reads Paid with its stage dot filled.
    await page.goto("/invoicing?f=paid");
    const row = page.locator(".r", { hasText: ADDRESS });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Paid in full");
    await expect(row.locator(".d.paid")).toHaveCount(1);
    await expect(page.getByTestId("aged-buckets")).toBeVisible();
  });

  test("request payment drafts a 25% progress claim, computed server-side", async ({ page }) => {
    await signIn(page, staff!, /estimates/);
    await openMoneyView(page);
    await page.getByRole("button", { name: "Request payment" }).click();
    await page.locator(".pchip", { hasText: "25%" }).click();
    await expect(page.getByTestId("request-preview")).toHaveText("$4,625.00");
    await page.getByRole("button", { name: "Draft invoice" }).click();

    await expect(page.getByText("Draft created.")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Invoices" }).click();
    await expect(page.getByTestId("invoice-card-progress")).toBeVisible({ timeout: 15_000 });
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

    await signIn(page, staff!, /estimates/);

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
    page.once("dialog", (d) => d.accept()); // confirm invoice-in-full
    await page.getByRole("button", { name: "Invoice in full" }).click();
    // The draft lands in the Invoices tab — switch to it before looking.
    await expect(page.getByText("Final invoice drafted from the ledger.")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("navigation").getByRole("button", { name: "Invoices" }).click();
    await expect(page.getByTestId("invoice-card-final")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("invoice-card-final").getByRole("link", { name: "Open" }).click();
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

    await signIn(page, staff!, /estimates/);
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

  // ---- Step 4: Stripe, degraded mode -------------------------------------
  // Without STRIPE_SECRET_KEY (per Tom's C1 ruling, test keys live only in
  // the dedicated test project) the card path must vanish CLEANLY: bank
  // transfer only, a friendly refusal on the checkout route, and a webhook
  // that answers 503 rather than pretending. Test-card e2e runs on C1.

  test("without Stripe keys the card path degrades to bank-transfer only", async ({ browser }) => {
    test.skip(Boolean(process.env.STRIPE_SECRET_KEY),
      "Stripe keys are configured — the degraded-mode assertions don't apply");

    // Issue the progress draft so there is an OPEN invoice with a balance —
    // the strongest case: payable, and still bank-transfer only.
    const { data: prog } = await db!.from("invoices")
      .select("id, token").eq("estimate_id", estimateId!).eq("kind", "progress").single();
    const progress = prog as { id: string; token: string };
    const issued = await rpcAs(staff!, "invoice_issue", { p_invoice_id: progress.id });
    expect(String(issued)).toContain("ok");
    const token = progress.token;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId("invoice-sheet")).toBeVisible();
    await expect(page.getByText("How to pay — bank transfer")).toBeVisible();
    await expect(page.getByTestId("pay-panel")).toHaveCount(0);

    const checkout = await page.request.post(`/i/${token}/checkout`);
    expect(checkout.status()).toBe(503);
    expect(await checkout.text()).toContain("bank transfer");

    const webhook = await page.request.post("/api/webhooks/stripe", { data: "{}" });
    expect(webhook.status()).toBe(503);
    await ctx.close();
  });
});
