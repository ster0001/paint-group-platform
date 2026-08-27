import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderHtmlToPdf } from "@/lib/invoicing/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY diagnostic (Tom, 27 Aug): every pdf_path on prod is null — the
 * Chromium pipeline has never worked on Vercel and reportError has no sink
 * there. Staff-gated; returns the real failure so it can be fixed. REMOVE
 * once the pipeline is proven on prod.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "staff") return NextResponse.json({ error: "not found" }, { status: 404 });

  const t0 = Date.now();
  try {
    const pdf = await renderHtmlToPdf("<h1>pdf pipeline probe</h1>");
    return NextResponse.json({ ok: true, bytes: pdf.length, ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 6) : undefined,
    });
  }
}
