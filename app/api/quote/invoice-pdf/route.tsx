import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { reportError } from "@/lib/monitoring/report";
import { priceEstimateTotals, type BlockInput } from "@/lib/pricing/estimate";
import { adjustmentsFrom } from "@/lib/pricing/context";
import { estimatePricingContext } from "@/lib/revision/pricingContext";
import { revisionInvoiceDoc } from "@/lib/revision/invoiceDoc";
import { loadInvoiceVariations } from "@/lib/revision/invoiceVariations";
import { DEFAULT_COMPANY, type CompanyProfile } from "@/app/quote/company";
import InvoiceSheet from "@/app/i/[token]/InvoiceSheet";
import RevisionInvoiceNote from "@/app/quote/RevisionInvoiceNote";

export const dynamic = "force-dynamic";

/**
 * The revision INVOICE as a PDF (Tom, 2 Nov 2026: "allow to convert to a pdf
 * to download to send to a client who wants to see costs — make sure pending
 * variations are included").
 *
 * Staff only. The browser sends the working scope's descriptive lines; every
 * figure is settled here: the contract subtotal is re-priced from the SAVED
 * working scope on the estimate's own rate card (a mismatch means unsaved
 * edits → 409, save first), and the variations are re-read from the job. The
 * same InvoiceSheet + lib/revision/invoiceDoc.ts the INVOICE tab draws, printed
 * through the invoice Chromium pipeline (lib/invoicing/pdf.ts). Nothing is
 * stored — the file is a snapshot of today, not an issued invoice.
 */

const line = z.object({
  description: z.string().max(4000),
  amount_ex_cents: z.number().int(),
  source: z.enum(["estimate_snapshot", "adjustment"]),
  qty: z.null(),
  approved_on: z.null(),
});

const input = z.object({
  estimateId: z.string().uuid(),
  header: z.object({
    billed_to: z.string().max(300),
    job_address: z.string().max(500),
    job_title: z.string().max(300),
  }),
  contractLines: z.array(line).max(400),
  contractSubtotalExCents: z.number().int(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const supabase = await createClient();
  if (!(await requireStaff(supabase))) return new NextResponse("Not found", { status: 404 });

  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Bad request", { status: 400 });
  const { estimateId, header, contractLines, contractSubtotalExCents } = parsed.data;

  const [scopeRes, estimateRes, woRes, companyRes] = await Promise.all([
    supabase.from("wo_working_scopes").select("working_state").eq("estimate_id", estimateId).maybeSingle(),
    supabase.from("estimates").select("rate_card_id").eq("id", estimateId).maybeSingle(),
    supabase.from("work_orders").select("id").eq("estimate_id", estimateId).maybeSingle(),
    supabase.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
  ]);
  const readError = scopeRes.error ?? estimateRes.error ?? woRes.error ?? companyRes.error;
  if (readError) {
    reportError(readError, { where: "quote.invoicePdf.read", extra: { estimateId } });
    return new NextResponse("Unavailable", { status: 503 });
  }
  if (!scopeRes.data || !estimateRes.data || !woRes.data) return new NextResponse("Not found", { status: 404 });

  // Re-price the SAVED working scope — the browser's subtotal is a claim.
  const working = (scopeRes.data.working_state ?? {}) as Record<string, unknown>;
  const { ctx } = await estimatePricingContext(supabase, estimateRes.data.rate_card_id as string | null);
  if (ctx.rateItems.length === 0) return new NextResponse("Unavailable", { status: 503 });
  const blocks = (Array.isArray(working.blocks) ? working.blocks : []) as BlockInput[];
  const priced = priceEstimateTotals(blocks, ctx, adjustmentsFrom(working));
  if (priced.netSubtotalCents !== contractSubtotalExCents) {
    return new NextResponse("Save the working scope first", { status: 409 });
  }

  const vars = await loadInvoiceVariations(supabase, woRes.data.id as string);
  if (vars.error) {
    reportError(vars.error, { where: "quote.invoicePdf.variations", extra: { estimateId } });
    return new NextResponse("Unavailable", { status: 503 });
  }

  const invoice = revisionInvoiceDoc({
    header,
    contractLines,
    contractSubtotalExCents: priced.netSubtotalCents,
    variations: vars.rows,
  });
  const company: CompanyProfile = { ...DEFAULT_COMPANY, ...((companyRes.data?.value as Partial<CompanyProfile>) ?? {}) };

  try {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const sheet = renderToStaticMarkup(
      <InvoiceSheet
        doc={invoice.doc}
        entity={{
          tradingName: company.name,
          address: [company.addressLine1, company.addressLine2].filter(Boolean).join(", "),
          abn: company.abn,
        }}
        bank={{ accountName: company.bankName, bank: company.bank, bsb: company.bsb, acc: company.acc }}
        extraNote={<RevisionInvoiceNote pendingCount={invoice.pendingCount} pendingInScope={invoice.pendingInScope} />}
      />,
    );
    const css = readFileSync(join(process.cwd(), "app", "i", "[token]", "invoice.css"), "utf8");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>${css}</style></head>`
      + `<body style="margin:0"><div class="invoice-view print-mode"><div class="sheet-wrap">${sheet}</div></div></body></html>`;
    const { renderHtmlToPdf } = await import("@/lib/invoicing/pdf");
    const pdf = await renderHtmlToPdf(html);
    const slug = (header.job_address.split(",")[0] || header.job_title || "job")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "job";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${slug}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    reportError(e, { where: "quote.invoicePdf.render", extra: { estimateId } });
    return new NextResponse("Unavailable", { status: 503 });
  }
}
