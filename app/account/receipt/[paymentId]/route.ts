import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/data";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureReceiptPdf, signedDocUrl } from "@/lib/invoicing/pdf";

// Cold-start Chromium + render can pass 10s — give the pdf paths room.
export const maxDuration = 60;

/**
 * 3a-3 · One-tap receipt PDF for the signed-in customer. Ownership is
 * proven through the chain — payment → invoice → estimate.account_id must
 * be one of the caller's accounts — before any signed URL is minted.
 * Anything else is a 404, never a 403 (the token-route rule).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  if (!z.string().uuid().safeParse(paymentId).success) return new NextResponse(null, { status: 404 });

  const ctx = await getPortalContext();
  if (!ctx) return new NextResponse(null, { status: 404 });
  const owned = new Set(ctx.accounts.map((a) => a.id));
  if (!owned.size) return new NextResponse(null, { status: 404 });

  const svc = createServiceClient();
  if (!svc) return new NextResponse(null, { status: 404 });

  const { data: pay } = await svc
    .from("payments")
    .select("id, status, invoice_id, invoices!inner(estimate_id, estimates!inner(account_id))")
    .eq("id", paymentId)
    .maybeSingle();
  const accountId = (pay as { invoices?: { estimates?: { account_id: string | null } } } | null)
    ?.invoices?.estimates?.account_id;
  if (!pay || (pay as { status?: string }).status !== "succeeded" || !accountId || !owned.has(accountId)) {
    return new NextResponse(null, { status: 404 });
  }

  const path = await ensureReceiptPdf(paymentId);
  const url = path ? await signedDocUrl(path, 300) : null;
  if (!url) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url);
}
