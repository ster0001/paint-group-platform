import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureInvoicePdf, signedDocUrl } from "@/lib/invoicing/pdf";

export const dynamic = "force-dynamic";
// Cold-start Chromium + render can pass 10s — give the pdf paths room.
export const maxDuration = 60;

/**
 * Staff PDF download: heal-if-missing, then redirect to a short-lived signed
 * URL (the bucket is private; the browser never sees a storage credential).
 * Drafts have no PDF by design — the document locks at issue.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role !== "staff") {
    return new NextResponse("Not found.", { status: 404 });
  }

  const { data: invoice } = await supabase
    .from("invoices").select("id, status, pdf_path").eq("id", id).maybeSingle();
  const inv = invoice as { id: string; status: string; pdf_path: string | null } | null;
  if (!inv) return new NextResponse("Not found.", { status: 404 });
  if (inv.status === "draft") {
    return new NextResponse("Drafts have no PDF — the document locks (and renders) at issue.", { status: 409 });
  }

  const path = inv.pdf_path ?? (await ensureInvoicePdf(id));
  if (!path) {
    return new NextResponse("The PDF couldn't be generated just now — try again shortly.", { status: 503 });
  }
  const url = await signedDocUrl(path);
  if (!url) return new NextResponse("The PDF couldn't be fetched just now.", { status: 503 });
  return NextResponse.redirect(url);
}
