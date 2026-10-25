import { test, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InvoiceSheet, { type SheetDoc } from "@/app/i/[token]/InvoiceSheet";

/**
 * Tom, 25 Oct 2026: "the invoice the client receives has the Paint Home logo
 * on it". The sheet (which the PDF is a print of) draws the Paint Home mark
 * where the PAINT GROUP wordmark sits when the invoice's brand is Paint Home,
 * and the wordmark otherwise.
 */
const doc: SheetDoc = {
  number: "INV-0001", kind: "deposit", status: "sent", issued_on: "2026-10-25", due_on: "2026-11-01",
  subtotal_ex_cents: 100_000, gst_cents: 10_000, total_inc_cents: 110_000, billed_to: "A Customer", job_address: "1 Test St", job_title: "Test job",
  lines: [{ description: "Deposit", amount_ex_cents: 100_000, source: "manual", qty: null, approved_on: null }],
  payments: [], paid_cents: 0, adjusted_contract_cents: null, previously_invoiced_cents: null, previous_numbers: null,
};
const entity = { tradingName: "Paint Home", abn: "00 000 000 000", address: "Melbourne" };

test("a Paint Home invoice carries the Paint Home mark; a Paint Group one keeps the wordmark", () => {
  const ph = renderToStaticMarkup(createElement(InvoiceSheet, { doc, entity, bank: {}, brand: "painthome" }));
  expect(ph).toContain('data-testid="painthome-logo-nav"');
  expect(ph).not.toContain("PAINT<span>GROUP</span>");
  const pg = renderToStaticMarkup(createElement(InvoiceSheet, { doc, entity: { ...entity, tradingName: "Paint Group" }, bank: {} }));
  expect(pg).toContain("PAINT<span>GROUP</span>");
  expect(pg).not.toContain("painthome-logo");
});
