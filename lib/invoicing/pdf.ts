import { existsSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { reportError } from "@/lib/monitoring/report";
import { buildReceiptHtml } from "./receiptHtml";
import { buildRemittanceHtml, type RemittanceDeduction } from "./remittanceHtml";

/**
 * SERVER ONLY — the §6.7 PDF pipeline.
 *
 * The invoice PDF is a PRINT of the customer token page (`/i/[token]?print=1`)
 * through headless Chromium — so what staff previewed, what the customer's
 * browser shows and what the PDF locks are the same document by construction,
 * not by keeping two templates in sync. Receipts are small standalone
 * documents rendered from an HTML string.
 *
 * Immutability: generation only ever happens while `pdf_path` is NULL — the
 * `invoice_attach_pdf` RPC writes the path exactly once and the 20261112
 * trigger refuses any later change. `ensureInvoicePdf` is therefore a
 * heal-if-missing, never a regenerate: a failed render at issue time can be
 * retried, a succeeded one can never be replaced.
 *
 * Chromium resolution: @sparticuz/chromium on Vercel/Lambda; a local Chrome
 * (INVOICE_CHROME_PATH or the standard install locations) in dev; the
 * Playwright-bundled Chromium as the dev fallback.
 */

const BUCKET = "invoice-docs";

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

async function launchBrowser() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const local =
    process.env.INVOICE_CHROME_PATH ??
    [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
    ].find((p) => existsSync(p));
  if (local) return puppeteer.launch({ executablePath: local, headless: true });
  // Dev fallback: the Chromium Playwright already installed for e2e.
  const { chromium } = await import("playwright-core");
  return puppeteer.launch({ executablePath: chromium.executablePath(), headless: true });
}

const PDF_OPTS = {
  format: "a4" as const,
  printBackground: true,
  margin: { top: "14mm", bottom: "16mm", left: "13mm", right: "13mm" },
};

export async function renderUrlToPdf(url: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    return Buffer.from(await page.pdf(PDF_OPTS));
  } finally {
    await browser.close();
  }
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    return Buffer.from(await page.pdf(PDF_OPTS));
  } finally {
    await browser.close();
  }
}

/**
 * Make sure an issued invoice has its PDF. Returns the storage path, or null
 * with the reason reported when generation isn't possible. Never regenerates:
 * an existing pdf_path is returned untouched.
 */
export async function ensureInvoicePdf(invoiceId: string): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return null;

  const { data } = await service
    .from("invoices")
    .select("id, number, status, pdf_path, token")
    .eq("id", invoiceId)
    .maybeSingle();
  const inv = data as { id: string; number: string | null; status: string; pdf_path: string | null; token: string } | null;
  if (!inv || inv.status === "draft" || !inv.number) return null;
  if (inv.pdf_path) return inv.pdf_path;

  try {
    const pdf = await renderUrlToPdf(`${siteUrl()}/i/${inv.token}?print=1`);
    const path = `${inv.id}/${inv.number}.pdf`;
    const up = await service.storage.from(BUCKET).upload(path, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
    const attach = await service.rpc("invoice_attach_pdf", { p_invoice_id: inv.id, p_path: path });
    const result = String(attach.data ?? "");
    if (attach.error) throw new Error(attach.error.message);
    if (!result.startsWith("ok:") && result !== "error:pdf_immutable") throw new Error(result);
    return path;
  } catch (e) {
    reportError(e, { where: "ensureInvoicePdf", extra: { invoiceId } });
    return null;
  }
}

/** Receipt PDF for one succeeded payment — same attach-once discipline. */
export async function ensureReceiptPdf(paymentId: string): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return null;

  const { data } = await service
    .from("payments")
    .select("id, invoice_id, amount_cents, surcharge_cents, method, paid_on, receipt_number, receipt_pdf_path")
    .eq("id", paymentId)
    .maybeSingle();
  const pay = data as {
    id: string; invoice_id: string; amount_cents: number; surcharge_cents: number;
    method: string | null; paid_on: string | null; receipt_number: string | null;
    receipt_pdf_path: string | null;
  } | null;
  if (!pay || !pay.receipt_number) return null;
  if (pay.receipt_pdf_path) return pay.receipt_pdf_path;

  try {
    const [{ data: inv }, { data: settings }] = await Promise.all([
      service.from("invoices")
        .select("id, number, estimate_id, estimates(accepted_name, job_address:sent_snapshot->>jobAddress)")
        .eq("id", pay.invoice_id).maybeSingle(),
      service.from("settings").select("key, value").in("key", ["invoicing_entity", "invoicing_bank"]),
    ]);
    const invoice = inv as {
      id: string; number: string | null;
      estimates: { accepted_name: string | null; job_address: string | null } | null;
    } | null;
    if (!invoice) return null;
    const rows = (settings ?? []) as { key: string; value: Record<string, string> }[];

    const html = buildReceiptHtml({
      receiptNumber: pay.receipt_number,
      invoiceNumber: invoice.number ?? "",
      amountCents: pay.amount_cents,
      surchargeCents: pay.surcharge_cents,
      method: pay.method ?? "payment",
      paidOn: pay.paid_on,
      billedTo: invoice.estimates?.accepted_name ?? "",
      jobAddress: invoice.estimates?.job_address ?? "",
      entity: rows.find((r) => r.key === "invoicing_entity")?.value ?? {},
    });
    const pdf = await renderHtmlToPdf(html);
    const path = `${invoice.id}/${pay.receipt_number}.pdf`;
    const up = await service.storage.from(BUCKET).upload(path, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
    const attach = await service.rpc("payment_attach_receipt_pdf", { p_payment_id: pay.id, p_path: path });
    if (attach.error) throw new Error(attach.error.message);
    return path;
  } catch (e) {
    reportError(e, { where: "ensureReceiptPdf", extra: { paymentId } });
    return null;
  }
}

/** Remittance-advice PDF for a PAID contractor invoice (Step 5) — same
 * attach-once discipline as the receipt. */
export async function ensureRemittancePdf(contractorInvoiceId: string): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return null;

  const { data } = await service
    .from("contractor_invoices")
    .select("id, number, status, remittance_number, remittance_pdf_path, bank_reference, paid_at, " +
      "offer_cents, variation_delta_cents, deduction_lines, gst_cents, total_inc_cents, entity_snapshot, " +
      "work_orders(wo_ref, wo_snapshot)")
    .eq("id", contractorInvoiceId)
    .maybeSingle();
  const ci = data as {
    id: string; number: string | null; status: string; remittance_number: string | null;
    remittance_pdf_path: string | null; bank_reference: string; paid_at: string | null;
    offer_cents: number; variation_delta_cents: number; deduction_lines: RemittanceDeduction[];
    gst_cents: number; total_inc_cents: number;
    entity_snapshot: Record<string, string>;
    work_orders: { wo_ref: string; wo_snapshot: { jobTitle?: string } | null } | null;
  } | null;
  if (!ci || ci.status !== "paid" || !ci.remittance_number) return null;
  if (ci.remittance_pdf_path) return ci.remittance_pdf_path;

  try {
    const { data: settings } = await service
      .from("settings").select("key, value").eq("key", "invoicing_entity").maybeSingle();

    const html = buildRemittanceHtml({
      remittanceNumber: ci.remittance_number,
      ciNumber: ci.number ?? "",
      totalIncCents: ci.total_inc_cents,
      gstCents: ci.gst_cents,
      offerCents: ci.offer_cents,
      additionsCents: ci.variation_delta_cents,
      deductionLines: Array.isArray(ci.deduction_lines) ? ci.deduction_lines : [],
      paidOn: ci.paid_at ? ci.paid_at.slice(0, 10) : null,
      bankReference: ci.bank_reference,
      contractor: ci.entity_snapshot ?? {},
      woRef: ci.work_orders?.wo_ref ?? "",
      jobTitle: ci.work_orders?.wo_snapshot?.jobTitle ?? "",
      entity: ((settings as { value?: Record<string, string> } | null)?.value) ?? {},
    });
    const pdf = await renderHtmlToPdf(html);
    const path = `${ci.id}/${ci.remittance_number}.pdf`;
    const up = await service.storage.from(BUCKET).upload(path, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (up.error && !/already exists/i.test(up.error.message)) throw new Error(up.error.message);
    const attach = await service.rpc("contractor_invoice_attach_remittance_pdf", {
      p_id: ci.id, p_path: path,
    });
    if (attach.error) throw new Error(attach.error.message);
    return path;
  } catch (e) {
    reportError(e, { where: "ensureRemittancePdf", extra: { contractorInvoiceId } });
    return null;
  }
}

/** Short-lived signed URL for a stored document (the bucket is private). */
export async function signedDocUrl(path: string, expiresInSeconds = 600): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return null;
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) {
    reportError(error, { where: "signedDocUrl", extra: { path } });
    return null;
  }
  return data?.signedUrl ?? null;
}
