import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureContractorInvoicePdf, signedDocUrl } from "@/lib/invoicing/pdf";

export const dynamic = "force-dynamic";

/** Staff copy of a contractor's invoice PDF (the Payables row's PDF button). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "staff") return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data } = await supabase
    .from("contractor_invoices")
    .select("id, status, invoice_pdf_path")
    .eq("id", id)
    .maybeSingle();
  const ci = data as { id: string; status: string; invoice_pdf_path: string | null } | null;
  if (!ci || ci.status === "draft") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const path = ci.invoice_pdf_path ?? (await ensureContractorInvoicePdf(ci.id));
  if (!path) return NextResponse.json({ error: "pdf unavailable" }, { status: 503 });
  const url = await signedDocUrl(path);
  if (!url) return NextResponse.json({ error: "pdf unavailable" }, { status: 503 });
  return NextResponse.redirect(url);
}
