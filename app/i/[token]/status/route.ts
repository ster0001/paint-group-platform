import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Read-only poll for the §5.3 "Confirming your payment…" page. This route
 * NEVER writes — the webhook is the sole writer of card-payment success;
 * this only reports what the database can already back.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("invoice_by_token", { p_token: token });
  if (!data) return new NextResponse("Not found.", { status: 404 });
  const doc = data as { status: string; paid_cents: number; total_inc_cents: number };
  return NextResponse.json({
    status: doc.status,
    paidCents: doc.paid_cents,
    totalIncCents: doc.total_inc_cents,
  });
}
