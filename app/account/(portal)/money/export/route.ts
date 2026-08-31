import { NextResponse } from "next/server";
import { getPortalContext } from "@/lib/portal/data";
import { getTradeMoney } from "@/lib/portal/tradeData";
import { tradeMoneyCsv } from "@/lib/portal/tradeMoney";

export const dynamic = "force-dynamic";

/** Session 6 · The §5.6 CSV — the same view the screen shows, to the cent. */
export async function GET(): Promise<NextResponse> {
  const ctx = await getPortalContext();
  if (!ctx || !ctx.accounts.some((a) => a.account_type === "trade")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const view = await getTradeMoney(ctx, "trade");
  if (!view) return new NextResponse("Unavailable", { status: 503 });
  return new NextResponse(tradeMoneyCsv(view), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paint-group-receivables.csv"`,
    },
  });
}
