import { NextResponse } from "next/server";
import { getPortalContext, melbourneTodayYmd } from "@/lib/portal/data";
import { getTradeMoney } from "@/lib/portal/tradeData";
import { buildStatementHtml } from "@/lib/portal/statementHtml";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Session 6 · Statement (PDF) — the invoicing Chromium pipeline over the
 * same view-model as the screen and the CSV. */
export async function GET(): Promise<NextResponse> {
  const ctx = await getPortalContext();
  if (!ctx || !ctx.accounts.some((a) => a.account_type === "trade")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const view = await getTradeMoney(ctx, "trade");
  if (!view) return new NextResponse("Unavailable", { status: 503 });

  const svc = createServiceClient();
  const { data: companyRow } = svc
    ? await svc.from("settings").select("value").eq("key", "company_profile").maybeSingle()
    : { data: null };
  const company = (companyRow?.value ?? {}) as { name?: string; phone?: string; logoUrl?: string; logoUrlLight?: string };

  const html = buildStatementHtml({
    view,
    orgName: ctx.accounts.find((a) => a.account_type === "trade")?.name?.trim() || "Your organisation",
    companyName: company.name || "Paint Group",
    companyPhone: company.phone,
    logoUrl: company.logoUrlLight || company.logoUrl, // white document → light logo
    dateLabel: melbourneTodayYmd(),
  });
  const { renderHtmlToPdf } = await import("@/lib/invoicing/pdf");
  const pdf = await renderHtmlToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="paint-group-statement.pdf"`,
    },
  });
}
