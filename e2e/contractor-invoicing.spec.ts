import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, rpcAs, type LoopFixture,
} from "./fixtures/woLoop";
import { credentials, missingCreds, signIn } from "./helpers";
import { gstFromIncCents } from "../lib/invoicing/gst";

/**
 * Step 5 — contractor invoicing v2, AS THE CONTRACTOR and AS PC (brief §8.5).
 *
 * The three accept criteria, verbatim:
 *   · drafted amount reconciles to offer + variations to the cent
 *   · an unregistered contractor cannot produce a document saying Tax Invoice
 *   · deduction lines are visible to the contractor pre-submit
 * Plus: submit is validated (profile, pending deduction), approve → mark paid
 * records reference + remittance number, and the RCTI shortcut issues from
 * draft.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");

const OFFER = 250_000;      // $2,500 fixed offer
const ADDITION = 18_000;    // 3 hr × $60 accepted addition
const CLEAN_CREDIT = 6_000; // 1 hr credit, engine figure
const MANUAL_DEDUCTION = 15_000; // PC-set figure on started work
const TOTAL = OFFER + ADDITION - CLEAN_CREDIT - MANUAL_DEDUCTION; // 247,000

let fixture: LoopFixture | null = null;   // the main job
let fixtureB: LoopFixture | null = null;  // GST + pending-deduction job
let fixtureC: LoopFixture | null = null;  // RCTI job
let fixtureD: LoopFixture | null = null;  // payment-claims job
let contractorId = "";
let ciId = "";
let ciBId = "";

async function seedVariation(db2: SupabaseClient, workOrderId: string, over: Record<string, unknown>) {
  const { error } = await db2.from("wo_variations").insert({
    work_order_id: workOrderId,
    category: "extra_scope",
    comment: "seeded",
    status: "contractor_accepted",
    contractor_accepted_at: new Date().toISOString(),
    customer_responded_at: new Date().toISOString(),
    price_cents: 10_000,
    ...over,
  });
  if (error) throw new Error(`seed variation: ${error.message}`);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!db || !staff || !contractor) return;
    contractorId = (await contractorIdForEmail(db!, contractor!.email))!;
    fixture = await createLoopFixture(db!, contractorId, [{ heading: "Left", labels: ["Walls"] }]);
    fixtureB = await createLoopFixture(db!, contractorId, [{ heading: "Rear", labels: ["Walls"] }]);
    fixtureC = await createLoopFixture(db!, contractorId, [{ heading: "Side", labels: ["Walls"] }]);
    fixtureD = await createLoopFixture(db!, contractorId, [{ heading: "Front", labels: ["Walls"] }]);

    await db!.from("work_orders").update({ contractor_payment_cents: OFFER }).eq("id", fixture!.workOrderId);
    await db!.from("work_orders").update({ contractor_payment_cents: 100_000 }).eq("id", fixtureB!.workOrderId);
    await db!.from("work_orders").update({ contractor_payment_cents: 80_000 }).eq("id", fixtureC!.workOrderId);
    await db!.from("work_orders").update({ contractor_payment_cents: 200_000 }).eq("id", fixtureD!.workOrderId);

    // The main job's variation history, already settled both sides:
    await seedVariation(db!, fixture!.workOrderId, {
      comment: "Front porch — added", credit: false,
      est_hours: 3, contractor_rate_cents: 6_000, contractor_delta_cents: ADDITION,
    });
    await seedVariation(db!, fixture!.workOrderId, {
      comment: "Pergola — removed from scope", category: "scope_removed", credit: true,
      est_hours: 1, contractor_rate_cents: 6_000, contractor_delta_cents: CLEAN_CREDIT,
    });
    await seedVariation(db!, fixture!.workOrderId, {
      comment: "Left windows — removed after start", category: "scope_removed", credit: true,
      est_hours: 1, contractor_rate_cents: 6_000, contractor_delta_cents: 6_000,
      needs_manual_deduction: true, deduction_cents: MANUAL_DEDUCTION,
      deduction_note: "Half the prep was already done",
    });

    // A clean profile slate so the profile-gate test means something.
    await db!.from("contractors").update({
      abn: null, address: null, gst_registered: false,
    }).eq("id", contractorId);
  });

test.afterAll(async () => {
  if (!db || !staff || !contractor) return;
    await destroyLoopFixture(db!, fixture);
    await destroyLoopFixture(db!, fixtureB);
    await destroyLoopFixture(db!, fixtureC);
    await destroyLoopFixture(db!, fixtureD);
    // Leave the shared contractor usable for other suites.
    await db!.from("contractors").update({
      abn: "12 345 678 901", address: "1 Test St, Melbourne", gst_registered: false,
      rcti_agreement_signed_at: null,
    }).eq("id", contractorId);
  });


test.describe("contractor invoicing v2 — draft, submit, approve, pay", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  test("the auto-draft reconciles to offer + variations − deductions, to the cent", async () => {
    const { data, error } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: fixture!.workOrderId });
    expect(error).toBeNull();
    expect(String(data)).toMatch(/^ok:/);
    ciId = String(data).slice(3);

    const { data: ci } = await db!.from("contractor_invoices")
      .select("status, number, offer_cents, variation_delta_cents, deduction_lines, gst_cents, total_inc_cents, rcti")
      .eq("id", ciId).single();
    const row = ci as {
      status: string; number: string | null; offer_cents: number; variation_delta_cents: number;
      deduction_lines: { cents: number; manual: boolean; note: string }[];
      gst_cents: number; total_inc_cents: number; rcti: boolean;
    };
    expect(row.status).toBe("draft");
    expect(row.number).toBeNull(); // unnumbered until submitted
    expect(row.offer_cents).toBe(OFFER);
    expect(row.variation_delta_cents).toBe(ADDITION);
    expect(row.deduction_lines).toHaveLength(2);
    expect(row.deduction_lines.reduce((s, d) => s + d.cents, 0)).toBe(CLEAN_CREDIT + MANUAL_DEDUCTION);
    expect(row.deduction_lines.some((d) => d.manual && d.note.includes("Half the prep"))).toBe(true);
    expect(row.total_inc_cents).toBe(TOTAL);
    expect(row.gst_cents).toBe(0); // not registered
    expect(row.rcti).toBe(false);

    // Idempotent: a re-draft replaces the draft, one row stands.
    await db!.rpc("contractor_invoice_draft", { p_work_order_id: fixture!.workOrderId });
    const { count } = await db!.from("contractor_invoices")
      .select("id", { count: "exact", head: true }).eq("work_order_id", fixture!.workOrderId);
    expect(count).toBe(1);
    const { data: fresh } = await db!.from("contractor_invoices")
      .select("id").eq("work_order_id", fixture!.workOrderId).single();
    ciId = (fresh as { id: string }).id;
  });

  test("the contractor reviews it — deductions visible, heading is INVOICE, submit gated on profile", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/money/${ciId}`);

    // An unregistered contractor cannot produce a Tax Invoice.
    await expect(page.getByTestId("ci-heading")).toHaveText("INVOICE");
    await expect(page.getByTestId("ci-gst")).toHaveText("$0.00");
    await expect(page.getByTestId("ci-total")).toContainText("$2,470.00");

    // Both deductions on screen BEFORE submit, the manual one named as such.
    await expect(page.getByTestId("ci-deduction-0")).toBeVisible();
    await expect(page.getByTestId("ci-deduction-1")).toBeVisible();
    const doc = page.getByTestId("ci-document");
    await expect(doc).toContainText("set by the office");
    await expect(doc).toContainText("Half the prep was already done");

    // Profile incomplete → submitting is held, with the reason.
    await expect(page.getByTestId("submit-blocked")).toContainText("company profile");
  });

  test("profile completed → one-tap submit numbers and pins the document", async ({ page }) => {
    await db!.from("contractors").update({
      abn: "12 345 678 901", address: "1 Test St, Melbourne",
      bank_bsb: "063-000", bank_account_last4: "4321",
    }).eq("id", contractorId);

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/money/${ciId}`);
    await page.getByTestId("submit-invoice").click();
    await expect(page.getByTestId("ci-status")).toContainText("With the office", { timeout: 15_000 });

    const { data: ci } = await db!.from("contractor_invoices")
      .select("status, number, total_inc_cents, gst_registered_at_submit, entity_snapshot")
      .eq("id", ciId).single();
    const row = ci as {
      status: string; number: string | null; total_inc_cents: number;
      gst_registered_at_submit: boolean; entity_snapshot: Record<string, string>;
    };
    expect(row.status).toBe("submitted");
    expect(row.number).toMatch(/^CI-\d{4,}$/);
    expect(row.total_inc_cents).toBe(TOTAL);
    expect(row.gst_registered_at_submit).toBe(false);
    expect(row.entity_snapshot.abn).toBe("12 345 678 901");
    expect(row.entity_snapshot.bank_last4).toBe("4321");
  });

  test("a GST-registered contractor's document is a TAX INVOICE with GST backed out", async ({ page }) => {
    await db!.from("contractors").update({ gst_registered: true }).eq("id", contractorId);
    const { data } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: fixtureB!.workOrderId });
    ciBId = String(data).slice(3);

    // …but a credit still waiting on the PC's figure holds the submit (⚑10).
    await seedVariation(db!, fixtureB!.workOrderId, {
      comment: "Rear door — removed after start", category: "scope_removed", credit: true,
      status: "customer_approved", contractor_accepted_at: null,
      est_hours: 1, contractor_delta_cents: 6_000,
      needs_manual_deduction: true, deduction_cents: null,
    });

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/money/${ciBId}`);
    await expect(page.getByTestId("ci-heading")).toHaveText("TAX INVOICE");
    await expect(page.getByTestId("submit-blocked")).toContainText("pay adjustment");

    // The office settles the figure; the RPC would also refuse meanwhile.
    expect(await rpcAs(contractor!, "contractor_invoice_submit", { p_id: ciBId }))
      .toBe("error:deduction_pending");
    expect(await rpcAs(staff!, "wo_set_variation_deduction", {
      p_variation_id: (await db!.from("wo_variations").select("id")
        .eq("work_order_id", fixtureB!.workOrderId).eq("needs_manual_deduction", true).single())
        .data!.id,
      p_cents: 5_000, p_note: "agreed on the phone",
    })).toBe("ok:set");

    await page.goto(`/portal/money/${ciBId}`);
    await page.getByTestId("submit-invoice").click();
    await expect(page.getByTestId("ci-status")).toContainText("With the office", { timeout: 15_000 });

    const { data: ci } = await db!.from("contractor_invoices")
      .select("total_inc_cents, gst_cents, gst_registered_at_submit").eq("id", ciBId).single();
    const row = ci as { total_inc_cents: number; gst_cents: number; gst_registered_at_submit: boolean };
    expect(row.total_inc_cents).toBe(100_000 - 5_000); // the late deduction is in
    expect(row.gst_registered_at_submit).toBe(true);
    expect(row.gst_cents).toBe(gstFromIncCents(row.total_inc_cents)); // backed out, never added
  });

  test("PC: Payables tab → approve → mark paid with bank reference + remittance number", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/invoicing?tab=pay");

    await expect(page.getByTestId("tile-to-approve")).not.toHaveText("$0");
    await expect(page.getByTestId(`payable-${ciId}`)).toBeVisible();

    await page.getByTestId(`approve-ci-${ciId}`).click();
    await expect(page.getByTestId(`pay-ci-${ciId}`)).toBeVisible({ timeout: 15_000 });

    // Two prompts now: the bank reference, then the payment date.
    const answers = ["EFT-20260824-01", new Date().toISOString().slice(0, 10)];
    page.on("dialog", (d) => d.accept(answers.shift() ?? ""));
    await page.getByTestId(`pay-ci-${ciId}`).click();
    await expect(page.getByTestId(`payable-${ciId}`)).toContainText("Paid", { timeout: 15_000 });

    const { data: ci } = await db!.from("contractor_invoices")
      .select("status, bank_reference, remittance_number, paid_at").eq("id", ciId).single();
    const row = ci as { status: string; bank_reference: string; remittance_number: string | null; paid_at: string | null };
    expect(row.status).toBe("paid");
    expect(row.bank_reference).toBe("EFT-20260824-01");
    expect(row.remittance_number).toMatch(/^REM-\d{4,}$/);
    expect(row.paid_at).not.toBeNull();
  });

  test("the remittance PDF lands and the contractor can fetch it", async ({ page }) => {
    // Rendered behind the response — poll for the attach.
    await expect.poll(async () => {
      const { data } = await db!.from("contractor_invoices")
        .select("remittance_pdf_path").eq("id", ciId).single();
      return (data as { remittance_pdf_path: string | null }).remittance_pdf_path;
    }, { timeout: 30_000, intervals: [1_000] }).not.toBeNull();

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/money/${ciId}`);
    await expect(page.getByTestId("ci-paid")).toContainText("remittance REM-");
    await expect(page.getByTestId("remittance-link")).toBeVisible();
  });

  test("RCTI (⚑9): with the agreement signed, staff approve straight from draft", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    // Record the agreement, then draft — the row carries rcti.
    expect(await rpcAs(staff!, "contractor_set_rcti", { p_contractor_id: contractorId, p_signed: true })).toBe("ok");
    const { data } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: fixtureC!.workOrderId });
    const ciCId = String(data).slice(3);
    const { data: drafted } = await db!.from("contractor_invoices").select("rcti").eq("id", ciCId).single();
    expect((drafted as { rcti: boolean }).rcti).toBe(true);

    await page.goto("/invoicing?tab=pay");
    await page.getByTestId(`approve-ci-${ciCId}`).click();
    await expect(page.getByTestId(`pay-ci-${ciCId}`)).toBeVisible({ timeout: 15_000 });

    const { data: ci } = await db!.from("contractor_invoices")
      .select("status, number, submitted_at").eq("id", ciCId).single();
    const row = ci as { status: string; number: string | null; submitted_at: string | null };
    expect(row.status).toBe("approved");
    expect(row.number).toMatch(/^CI-\d{4,}$/); // issued on the contractor's behalf
    expect(row.submitted_at).not.toBeNull();
  });
});

test.describe("payment claims — invoice at any time (Tom, 24 Aug)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!contractor, missingCreds("CONTRACTOR"));

  let claimId = "";

  test("a 25% claim from the Money tab — born submitted, bounded, numbered", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal/money");

    await page.getByTestId("open-claim").click();
    await page.getByTestId("claim-pct-25").click();
    // Preview is the engine's arithmetic: 25% of the $2,000 offer.
    await expect(page.getByTestId("send-claim")).toContainText("$500.00");
    await page.getByTestId("send-claim").click();
    await expect(page.getByTestId("claim-message")).toContainText("Invoice sent", { timeout: 15_000 });

    const { data: rows } = await db!.from("contractor_invoices")
      .select("id, status, number, total_inc_cents, claim_pct, auto_draft_source, gst_cents")
      .eq("work_order_id", fixtureD!.workOrderId);
    const claims = rows as {
      id: string; status: string; number: string | null; total_inc_cents: number;
      claim_pct: number | null; auto_draft_source: string; gst_cents: number;
    }[];
    expect(claims).toHaveLength(1);
    claimId = claims[0].id;
    expect(claims[0].status).toBe("submitted");
    expect(claims[0].auto_draft_source).toBe("claim");
    expect(claims[0].total_inc_cents).toBe(50_000);
    expect(Number(claims[0].claim_pct)).toBe(25);
    expect(claims[0].number).toMatch(/^CI-\d{4,}$/);
  });

  test("the claim's PDF renders under the contractor's own details", async ({ page }) => {
    await expect.poll(async () => {
      const { data } = await db!.from("contractor_invoices")
        .select("invoice_pdf_path").eq("id", claimId).single();
      return (data as { invoice_pdf_path: string | null }).invoice_pdf_path;
    }, { timeout: 30_000, intervals: [1_000] }).not.toBeNull();

    await signIn(page, contractor!, /\/portal/);
    const pdf = await page.request.get(`/portal/money/${claimId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"] ?? "").toContain("pdf");
  });

  test("a fixed claim can never exceed what's left to invoice", async () => {
    // $2,000 contract − $500 claimed = $1,500 left; $1,600 is refused.
    expect(await rpcAs(contractor!, "contractor_invoice_request", {
      p_work_order_id: fixtureD!.workOrderId, p_mode: "fixed", p_value: 1600,
    })).toBe("error:exceeds_remaining");
  });

  test("the sign-off final drafts only the remainder", async () => {
    const { data } = await db!.rpc("contractor_invoice_draft", { p_work_order_id: fixtureD!.workOrderId });
    expect(String(data)).toMatch(/^ok:/);
    const { data: final } = await db!.from("contractor_invoices")
      .select("previously_invoiced_cents, total_inc_cents, auto_draft_source")
      .eq("work_order_id", fixtureD!.workOrderId).eq("status", "draft").single();
    expect(final).toEqual({
      previously_invoiced_cents: 50_000,
      total_inc_cents: 150_000,
      auto_draft_source: "signoff",
    });
  });

  test("payables shows the claim with the job's PC stage; paid with a DATE lands in the portal", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/invoicing?tab=pay");

    const row = page.getByTestId(`payable-${claimId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("claim 25%");
    await expect(row).toContainText("job: In progress"); // the PC stage, on the row
    await expect(page.getByTestId(`pdf-ci-${claimId}`)).toBeVisible();

    await page.getByTestId(`approve-ci-${claimId}`).click();
    await expect(page.getByTestId(`pay-ci-${claimId}`)).toBeVisible({ timeout: 15_000 });

    // Two prompts: bank reference, then the payment DATE.
    const answers = ["EFT-CLAIM-01", "2026-08-20"];
    page.on("dialog", (d) => d.accept(answers.shift() ?? ""));
    await page.getByTestId(`pay-ci-${claimId}`).click();
    await expect(row).toContainText("Paid", { timeout: 15_000 });

    const { data: ci } = await db!.from("contractor_invoices")
      .select("status, bank_reference, paid_at, remittance_number").eq("id", claimId).single();
    const paid = ci as { status: string; bank_reference: string; paid_at: string; remittance_number: string | null };
    expect(paid.status).toBe("paid");
    expect(paid.bank_reference).toBe("EFT-CLAIM-01");
    expect(paid.paid_at.slice(0, 10)).toBe("2026-08-20"); // the recorded date, not today
    expect(paid.remittance_number).toMatch(/^REM-/);

    // …and the contractor's Money tab reads Paid.
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/money/${claimId}`);
    await expect(page.getByTestId("ci-status")).toContainText("Paid");
  });
});
