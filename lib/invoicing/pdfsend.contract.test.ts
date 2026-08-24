/**
 * Step 3 contract pins — the PDF/send/token guarantees that must survive
 * every future edit, checked against the migration and pipeline text so a
 * regression fails `npm test` without a database.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const MIG = read("supabase/migrations/20261114000000_invoice_pdf_token.sql");
const PDF = read("lib/invoicing/pdf.ts");
const PAGE = read("app/i/[token]/page.tsx");

describe("regeneration after issue is impossible in code, not just unlinked", () => {
  it("the attach RPC writes pdf_path exactly once", () => {
    expect(MIG).toContain("if v.pdf_path is not null then return 'error:pdf_immutable'");
    expect(MIG).toContain("if v.receipt_pdf_path is not null then return 'error:pdf_immutable'");
  });
  it("drafts can never carry a PDF", () => {
    expect(MIG).toContain("if v.status = 'draft' then return 'error:not_issued'");
  });
  it("the pipeline is heal-if-missing, never regenerate", () => {
    expect(PDF).toContain("if (inv.pdf_path) return inv.pdf_path;");
    expect(PDF).toContain("if (pay.receipt_pdf_path) return pay.receipt_pdf_path;");
    expect(PDF).toContain("upsert: false");
  });
  it("the PDF is a print of the customer page — one document, not two templates", () => {
    expect(PDF).toContain("/i/${inv.token}?print=1");
  });
});

describe("the token exposes exactly one invoice's payload", () => {
  it("drafts are staff-preview only; unknown tokens are nothing", () => {
    expect(MIG).toContain("if v.status = 'draft' and not public.is_staff() then return null");
  });
  it("the bucket is private, pdf-only, service-access only", () => {
    expect(MIG).toMatch(/values \('invoice-docs', 'invoice-docs', false, 10485760, array\['application\/pdf'\]\)/);
  });
  it("customer visits are tracked; staff previews and the printer are not", () => {
    expect(PAGE).toContain('if (!isStaff && !printMode) {');
    expect(PAGE).toContain('supabase.rpc("invoice_mark_viewed", { p_token: token })');
  });
});

describe("⚑16 — sending degrades to the log driver, never blocks issuing", () => {
  const SEND = read("lib/invoicing/sendInvoice.ts");
  it("no provider configured → log the message, tell the caller", () => {
    expect(SEND).toContain("invoice-send:log-driver");
    expect(SEND).toContain('return { status: "not_configured", to };');
  });
  it("ATO print essentials are on the customer document", () => {
    expect(PAGE).toContain("TAX INVOICE");
    expect(PAGE).toContain("ABN {entity.abn}");
    expect(PAGE).toMatch(/GST<\/span>/);
    expect(PAGE).toContain("Total (inc GST)");
    expect(PAGE).toContain("Invoice to");
  });
});
