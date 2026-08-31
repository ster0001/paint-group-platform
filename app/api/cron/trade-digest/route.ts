import { NextResponse, type NextRequest } from "next/server";
import { runTradeDigest } from "@/lib/portal/digest";

export const dynamic = "force-dynamic";

/**
 * Session 6 · The digest cron (⚑11): schedule this at the top of each hour
 * (or just 17:00 Melbourne). Shared-secret header, the standing cron rule.
 *   ?hour=17  — override the Melbourne hour (testing)
 *   ?dryRun=1 — return the plan as JSON, send nothing, stamp nothing
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new NextResponse("Not found", { status: 404 });
  }
  const hourParam = req.nextUrl.searchParams.get("hour");
  const melbourneHour = hourParam != null
    ? Number(hourParam)
    : Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", hour12: false }).format(new Date()));
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;

  const plans = await runTradeDigest({ melbourneHour, origin, dryRun });
  return NextResponse.json({
    hour: melbourneHour,
    dryRun,
    sent: plans.length,
    plans: plans.map((p) => ({ email: p.email, orgName: p.orgName, lines: p.lines })),
  });
}
