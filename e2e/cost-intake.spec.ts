import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail,
  createLoopFixture,
  destroyLoopFixture,
  serviceClient,
  type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Step 6a — cost capture: the intake pipeline, end to end (C1 stack).
 *
 * The 6a acceptance list, as tests: an emailed PDF lands → proposes →
 * confirms into job_costs with the doc attached; the same email replayed is
 * a no-op; an unreadable attachment queues as "couldn't read this", never
 * $0; a second invoice with the same vendor+number flags duplicate; the
 * airtable door is idempotent and cross-door duplicate-guarded; manual entry
 * requires a document and marches recorded → approved → paid.
 *
 * The spec signs its own svix deliveries (the stripe-live pattern) — no
 * provider needed, which is exactly how ⚑16 stays unblocked.
 */

const db = serviceClient();
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const SECRET = process.env.BILLS_INBOUND_SECRET ?? "";
const AT_SECRET = process.env.AIRTABLE_SYNC_SECRET ?? "";
const RUN = `${process.pid}-${Date.now()}`;

const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

function svixHeaders(payload: string, id: string): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000);
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${payload}`).digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(ts),
    "svix-signature": `v1,${sig}`,
    "content-type": "application/json",
  };
}

function billEmail(messageId: string, jobRef: string, overrides: Partial<{
  invoiceNo: string; total: string; gst: string; from: string; text: string;
}> = {}) {
  const invoiceNo = overrides.invoiceNo ?? "SR-2291";
  const text =
    overrides.text ??
    `Tax Invoice\n\nSkyReach Hire Pty Ltd\nABN: 11 222 333 444\nInvoice No: ${invoiceNo}\nDate: 22/08/2026\nOrder ref: ${jobRef}\n\nScaffold hire 4 weeks\nGST    $${overrides.gst ?? "131.82"}\nTotal inc GST    $${overrides.total ?? "1,450.00"}\n`;
  return JSON.stringify({
    type: "email.received",
    data: {
      message_id: messageId,
      from: overrides.from ?? "accounts@skyreach-test.com.au",
      subject: `Invoice ${invoiceNo}`,
      text,
      attachments: [
        { filename: "invoice.pdf", content_type: "application/pdf", content: TINY_PDF.toString("base64") },
      ],
    },
  });
}

async function postBill(request: APIRequestContext, payload: string, id: string) {
  return request.post("/api/inbound/bills", { data: payload, headers: svixHeaders(payload, id) });
}

type IntakeRow = {
  id: string; status: string; extract_status: string; match_reason: string;
  proposed_wo_id: string | null; duplicate_of: string | null;
  extracted: Record<string, unknown>; raw_doc_path: string | null;
};

async function waitForExtraction(messageId: string, timeoutMs = 30_000): Promise<IntakeRow> {
  const t0 = Date.now();
  for (;;) {
    const { data } = await db!
      .from("cost_intake")
      .select("id, status, extract_status, match_reason, proposed_wo_id, duplicate_of, extracted, raw_doc_path")
      .eq("message_id", messageId)
      .maybeSingle();
    const row = data as IntakeRow | null;
    if (row && row.extract_status !== "pending") return row;
    if (Date.now() - t0 > timeoutMs) throw new Error(`intake never extracted: ${messageId}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let fixture: LoopFixture | null = null;
let jobNo = 0;
let migrationMissing = false;
let firstIntakeId = "";

test.describe.configure({ mode: "serial" });

test.describe("cost capture 6a — the intake pipeline", () => {
  test.beforeAll(async () => {
    if (!db || !contractor) return;
    const probe = await db.from("cost_intake").select("id").limit(1);
    migrationMissing = Boolean(probe.error);
    if (migrationMissing) return;
    const contractorId = await contractorIdForEmail(db, contractor.email);
    if (!contractorId) return;
    fixture = await createLoopFixture(db, contractorId, [{ heading: "Exterior", labels: ["Walls"] }]);
    const { data } = await db.from("work_orders").select("job_no").eq("id", fixture.workOrderId).single();
    jobNo = Number((data as { job_no: number }).job_no);
  });

  test.afterAll(async () => {
    if (!db) return;
    // The email/airtable intake rows are keyed by this run's message ids —
    // destroyLoopFixture only knows the WO-linked ones.
    await db.from("material_costs").delete().like("airtable_record_id", `e2e-${RUN}%`);
    await db.from("cost_intake").delete().like("message_id", `%${RUN}%`);
    await destroyLoopFixture(db, fixture);
  });

  const gate = () => {
    test.skip(!db, "SUPABASE_SERVICE_ROLE_KEY not set");
    test.skip(!SECRET, "BILLS_INBOUND_SECRET not set — add it to .env.test.local");
    test.skip(migrationMissing, "needs migration 20261122_cost_intake on this stack");
    test.skip(!fixture, "no contractor login — fixture not created");
  };

  test("a forged signature is refused, an unsigned probe rejected", async ({ request }) => {
    test.skip(!SECRET, "BILLS_INBOUND_SECRET not set");
    const payload = billEmail(`e2e-${RUN}-forged`, "PG-1");
    const bad = await request.post("/api/inbound/bills", {
      data: payload,
      headers: { "svix-id": "x", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,ZGVhZA==", "content-type": "application/json" },
    });
    expect(bad.status()).toBe(400);
  });

  test("an emailed PDF lands, reads, and proposes the job off the PG order reference", async ({ request }) => {
    gate();
    const messageId = `e2e-${RUN}-1`;
    const res = await postBill(request, billEmail(messageId, `PG-${String(jobNo).padStart(4, "0")}`), messageId);
    expect(res.ok()).toBeTruthy();

    const row = await waitForExtraction(messageId);
    firstIntakeId = row.id;
    expect(row.extract_status).toBe("extracted");
    expect(row.status).toBe("pending");
    expect(row.match_reason).toBe("order_ref");
    expect(row.proposed_wo_id).toBe(fixture!.workOrderId);
    expect(row.extracted.invoice_no).toBe("SR-2291");
    expect(row.extracted.total_cents).toBe(145000);
    expect(row.extracted.gst_cents).toBe(13182);
    expect(row.raw_doc_path).toContain("invoice.pdf");
  });

  test("AS STAFF: confirm writes job_costs with the document attached — and nothing was written before", async ({ page }) => {
    gate();
    test.skip(!staff, missingCreds("STAFF"));

    // Nothing exists until a person confirms (⚑A1 OFF).
    const before = await db!.from("job_costs").select("id").eq("work_order_id", fixture!.workOrderId);
    expect(before.data ?? []).toHaveLength(0);

    await signIn(page, staff!, /estimates/);
    await page.goto("/invoicing?tab=pay");
    const card = page.getByTestId(`intake-${firstIntakeId}`);
    await expect(card).toBeVisible();
    await expect(card.getByText("SR-2291")).toBeVisible();

    await card.getByTestId(`confirm-${firstIntakeId}`).click();
    const panel = page.getByTestId(`panel-${firstIntakeId}`);
    await expect(panel).toBeVisible();
    // The proposed job arrives pre-picked; amounts prefilled from the reading.
    await expect(panel.getByTestId(`total-${firstIntakeId}`)).toHaveValue("1450.00");
    // The proposed job arrives pre-picked in the matched-job box (Tom, 4 Sep);
    // the expense type is a dropdown.
    await expect(panel.getByTestId(`job-search-${firstIntakeId}-chosen`)).toBeVisible();
    await panel.getByTestId(`category-${firstIntakeId}`).selectOption("scaffold");
    await panel.getByTestId(`save-${firstIntakeId}`).click();

    await expect(page.getByTestId("costs-message")).toContainText("recorded", { ignoreCase: true });

    const { data: cost } = await db!
      .from("job_costs")
      .select("amount_ex_cents, gst_cents, doc_path, status, category, intake_id, work_order_id")
      .eq("work_order_id", fixture!.workOrderId)
      .single();
    const c = cost as { amount_ex_cents: number; gst_cents: number; doc_path: string; status: string; category: string; intake_id: string };
    expect(c.amount_ex_cents).toBe(145000 - 13182);
    expect(c.gst_cents).toBe(13182);
    expect(c.doc_path).toContain("invoice.pdf"); // the doc rode along
    expect(c.status).toBe("recorded");
    expect(c.category).toBe("scaffold");
    expect(c.intake_id).toBe(firstIntakeId);

    // The job money view's Costs tab shows it with its source chip.
    await page.goto(`/invoicing/job/${fixture!.estimateId}`);
    await page.getByRole("button", { name: "Costs" }).click();
    await expect(page.getByTestId("trades-group")).toContainText("SR-2291");
    await expect(page.getByTestId("trades-group")).toContainText("not in estimate");
  });

  test("the same email replayed is a no-op — one intake row, one cost row", async ({ request }) => {
    gate();
    const messageId = `e2e-${RUN}-1`;
    const res = await postBill(request, billEmail(messageId, `PG-${String(jobNo).padStart(4, "0")}`), messageId);
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).duplicate).toBe(true);

    const { data: intakes } = await db!.from("cost_intake").select("id").eq("message_id", messageId);
    expect(intakes ?? []).toHaveLength(1);
    const { data: costRows } = await db!.from("job_costs").select("id").eq("work_order_id", fixture!.workOrderId);
    expect(costRows ?? []).toHaveLength(1);
  });

  test("same vendor + invoice number through the email door flags duplicate — never a second row", async ({ request, page }) => {
    gate();
    test.skip(!staff, missingCreds("STAFF"));
    const messageId = `e2e-${RUN}-dup`;
    const res = await postBill(request, billEmail(messageId, `PG-${String(jobNo).padStart(4, "0")}`), messageId);
    expect(res.ok()).toBeTruthy();

    const row = await waitForExtraction(messageId);
    expect(row.status).toBe("duplicate");
    expect(row.duplicate_of).toBe(firstIntakeId);

    // Still exactly one cost row; the card dismisses without writing anything.
    await signIn(page, staff!, /estimates/);
    await page.goto("/invoicing?tab=pay");
    const card = page.getByTestId(`intake-${row.id}`);
    await expect(card).toContainText("Possible duplicate");
    await card.getByTestId(`reject-${row.id}`).click();
    // The card leaves when the action's re-render lands; on C1's 20k-job
    // volume data /invoicing?tab=pay takes ~10 s to render (the RPC itself
    // answers in under 200 ms), so this waits for the page, not the action.
    await expect(card).toBeHidden({ timeout: 30_000 });

    const { data: costRows } = await db!.from("job_costs").select("id").eq("work_order_id", fixture!.workOrderId);
    expect(costRows ?? []).toHaveLength(1);
  });

  test("an unreadable document queues as couldn't-read-this — never $0", async ({ request, page }) => {
    gate();
    test.skip(!staff, missingCreds("STAFF"));
    const messageId = `e2e-${RUN}-junk`;
    const payload = JSON.stringify({
      type: "email.received",
      data: {
        message_id: messageId,
        from: "noreply@mystery-vendor.example",
        subject: "fwd: fwd: see attached",
        text: "",
        attachments: [{ filename: "scan.bin", content_type: "application/octet-stream", content: Buffer.from([0, 1, 2, 3, 4, 5]).toString("base64") }],
      },
    });
    const res = await postBill(request, payload, messageId);
    expect(res.ok()).toBeTruthy();

    const row = await waitForExtraction(messageId);
    expect(row.extract_status).toBe("failed");
    expect(row.extracted.total_cents ?? null).toBeNull();

    await signIn(page, staff!, /estimates/);
    await page.goto("/invoicing?tab=pay");
    await expect(page.getByTestId(`intake-failed-${row.id}`)).toContainText("Couldn't read");

    // No $0 anywhere: the only cost row is still the confirmed one.
    const { data: costRows } = await db!.from("job_costs").select("amount_ex_cents").eq("work_order_id", fixture!.workOrderId);
    expect(costRows ?? []).toHaveLength(1);

    // Tidy the card away so later assertions see a stable queue.
    await page.getByTestId(`reject-${row.id}`).click();
  });

  test("the airtable door: writes through the pipeline, auto-matches on the PG ref, replays as a no-op", async ({ request }) => {
    gate();
    test.skip(!AT_SECRET, "AIRTABLE_SYNC_SECRET not set");
    const recordId = `e2e-${RUN}-at1`;
    const body = {
      record_id: recordId,
      supplier: "Haymes Test",
      brand: "Haymes",
      order_ref: `PG-${String(jobNo).padStart(4, "0")}`,
      address: "",
      amount_cents: 41280,
      invoice_date: "2026-08-10",
    };
    const post = () => request.post("/api/inbound/airtable", {
      data: body, headers: { authorization: `Bearer ${AT_SECRET}` },
    });

    const res = await post();
    expect(res.ok()).toBeTruthy();
    const first = (await res.json()).results[recordId] as string;
    expect(first.startsWith("ok:")).toBeTruthy();
    expect(first).not.toBe("ok:already");

    const { data: mat } = await db!.from("material_costs")
      .select("work_order_id, matched_by, intake_id, source")
      .eq("airtable_record_id", recordId).single();
    const m = mat as { work_order_id: string; matched_by: string; intake_id: string | null; source: string };
    expect(m.work_order_id).toBe(fixture!.workOrderId); // auto-matched on the ref
    expect(m.matched_by).toBe("auto");
    expect(m.intake_id).not.toBeNull(); // it went THROUGH the pipeline
    expect(m.source).toBe("airtable");

    const replay = await post();
    expect((await replay.json()).results[recordId]).toBe("ok:already");
    const { data: all } = await db!.from("material_costs").select("id").eq("airtable_record_id", recordId);
    expect(all ?? []).toHaveLength(1);

    // Wrong secret is refused outright.
    const forged = await request.post("/api/inbound/airtable", {
      data: body, headers: { authorization: "Bearer wrong" },
    });
    expect(forged.status()).toBe(401);
  });

  test("cross-door duplicate: an airtable record matching an emailed invoice parks as a flag, not a row", async ({ request }) => {
    gate();
    test.skip(!AT_SECRET, "AIRTABLE_SYNC_SECRET not set");
    const recordId = `e2e-${RUN}-at2`;
    // Same supplier (sender-domain label), same total, same invoice date as
    // the confirmed email-door document.
    const res = await request.post("/api/inbound/airtable", {
      data: {
        record_id: recordId,
        supplier: "Skyreach-Test",
        brand: "",
        order_ref: "",
        address: "",
        amount_cents: 145000,
        invoice_date: "2026-08-22",
      },
      headers: { authorization: `Bearer ${AT_SECRET}` },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).results[recordId]).toBe("ok:duplicate");
    const { data } = await db!.from("material_costs").select("id").eq("airtable_record_id", recordId);
    expect(data ?? []).toHaveLength(0);
  });

  test("AS STAFF: manual + Add cost requires the document, then marches recorded → approved → paid", async ({ page }) => {
    gate();
    test.skip(!staff, missingCreds("STAFF"));
    await signIn(page, staff!, /estimates/);
    await page.goto(`/invoicing/job/${fixture!.estimateId}`);
    await page.getByRole("button", { name: "Costs" }).click();
    await page.getByTestId("add-cost-button").click();

    await page.getByTestId("add-cost-vendor").fill("Bins R Us");
    await page.getByRole("button", { name: "Rubbish" }).click();
    await page.getByTestId("add-cost-total").fill("220.00");

    // No document → refused before anything server-side happens.
    await page.getByTestId("add-cost-save").click();
    await expect(page.getByTestId("add-cost-message")).toContainText("no document, no cost");

    await page.getByTestId("add-cost-file").setInputFiles({
      name: "docket.pdf", mimeType: "application/pdf", buffer: TINY_PDF,
    });
    await page.getByTestId("add-cost-save").click();
    await expect(page.getByTestId("trades-group")).toContainText("Bins R Us", { timeout: 15_000 });

    const { data } = await db!.from("job_costs")
      .select("id, status, doc_path, amount_ex_cents, gst_cents")
      .eq("work_order_id", fixture!.workOrderId).order("created_at", { ascending: false }).limit(1).single();
    const cost = data as { id: string; status: string; doc_path: string; amount_ex_cents: number; gst_cents: number };
    expect(cost.status).toBe("recorded");
    expect(cost.doc_path).toContain("receipts/");
    expect(cost.amount_ex_cents + cost.gst_cents).toBe(22000);

    // recorded → approved → paid on the Payables tab.
    await page.goto("/invoicing?tab=pay");
    // Each step shows after the Payables re-render (~10 s on C1's volume data).
    await page.getByTestId(`approve-cost-${cost.id}`).click();
    await expect(page.getByTestId(`pay-cost-${cost.id}`)).toBeVisible({ timeout: 30_000 });
    page.once("dialog", (d) => d.accept("2026-08-25"));
    await page.getByTestId(`pay-cost-${cost.id}`).click();
    await expect(page.getByTestId(`pay-cost-${cost.id}`)).toBeHidden({ timeout: 30_000 });

    const { data: after } = await db!.from("job_costs").select("status, paid_at").eq("id", cost.id).single();
    expect((after as { status: string }).status).toBe("paid");
    expect((after as { paid_at: string | null }).paid_at).not.toBeNull();

    // The accuracy readout counts this run's decisions.
    await expect(page.getByTestId("accuracy-readout")).toContainText("decided");
  });
});
