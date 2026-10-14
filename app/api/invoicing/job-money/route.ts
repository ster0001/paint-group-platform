import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guards";
import { headlineSentences, jobMoneyPage } from "@/lib/invoicing/jobMoney";
import { loadJobMoneyInput } from "@/app/invoicing/jobMoneyData";
import { fmt2 } from "@/app/invoicing/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payments merge, Step 1: the raw derived rows, for checking before the page
 * exists (brief §5 Step 1 — "no UI beyond a raw JSON route"). Staff only, read
 * only, no input. The Step 2 page renders exactly this.
 */
export async function GET() {
  const supabase = await createClient();
  const user = await requireStaff(supabase);
  if (!user) return NextResponse.json({ error: "staff only" }, { status: 403 });
  const now = new Date();
  const { input, failure } = await loadJobMoneyInput(supabase, now);
  if (!input) return NextResponse.json({ error: failure?.headline ?? "read failed", detail: failure?.detail ?? null }, { status: 500 });
  const page = jobMoneyPage(input);
  return NextResponse.json({ asOf: now.toISOString(), headlineText: headlineSentences(page.headline, fmt2).join(" "), ...page });
}
