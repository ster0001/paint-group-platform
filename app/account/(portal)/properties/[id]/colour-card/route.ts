import { NextResponse } from "next/server";
import { getPortalContext, melbourneTodayYmd } from "@/lib/portal/data";
import { getTradeProperty } from "@/lib/portal/tradeData";
import { viewerTradeRole } from "@/lib/portal/approvalData";
import { buildColourCardHtml } from "@/lib/portal/colourCardHtml";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Session 6 · The downloadable colour card (⚑7) — property-scoped, finance
 * excluded (job detail), white A4 through the invoicing Chromium pipeline. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const ctx = await getPortalContext();
  if (!ctx || !ctx.accounts.some((a) => a.account_type === "trade")) {
    return new NextResponse("Not found", { status: 404 });
  }
  if ((await viewerTradeRole(ctx)) === "finance") return new NextResponse("Not found", { status: 404 });
  const d = await getTradeProperty(ctx, id, "trade");
  if (!d) return new NextResponse("Not found", { status: 404 });

  const svc = createServiceClient();
  const [companyRow, cardRow] = svc
    ? await Promise.all([
        svc.from("settings").select("value").eq("key", "company_profile").maybeSingle(),
        svc.from("settings").select("value").eq("key", "colour_card").maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const company = (companyRow.data?.value ?? {}) as { name?: string; phone?: string; logoUrl?: string; logoUrlLight?: string };
  const whereToBuy = ((cardRow.data?.value ?? {}) as { whereToBuy?: string }).whereToBuy ?? "";
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const html = buildColourCardHtml({
    address: d.property.address,
    referencesLine: d.references.length ? d.references.map((r) => `${r.label} · ${r.value}`).join("  ·  ") : null,
    cards: d.colourCards,
    whereToBuy,
    companyName: company.name || "Paint Group",
    companyPhone: company.phone,
    logoUrl: company.logoUrlLight || company.logoUrl, // white document → light logo
    touchUpUrl: `${origin}/account/properties/${id}?tab=colours`,
    dateLabel: melbourneTodayYmd(),
  });
  const { renderHtmlToPdf } = await import("@/lib/invoicing/pdf");
  const pdf = await renderHtmlToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="colour-card.pdf"`,
    },
  });
}
