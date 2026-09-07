import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseTracked } from "@/lib/campaigns/links";
import { buildEvent, dedupeKey } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A tracked campaign link (P5). Records the click — on the queue row, on the
 * messages row, and as a `cta_clicked` event on the timeline — then sends
 * the person where the button said. A bad token still goes somewhere true.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const home = (process.env.NEXT_PUBLIC_SITE_URL || "https://paintgroup.com.au").replace(/\/$/, "");
  const parsed = parseTracked(token);
  if (!parsed) return NextResponse.redirect(home, 302);

  const db = createServiceClient();
  if (db) {
    try {
      const { data: row } = await db.from("campaign_messages")
        .select("id, account_id, clicks, campaigns(key)").eq("id", parsed.messageId).maybeSingle();
      if (row) {
        const today = new Date().toISOString().slice(0, 10);
        await Promise.all([
          db.from("campaign_messages").update({ clicks: ((row.clicks as number) ?? 0) + 1 }).eq("id", row.id),
          db.from("messages").update({ status: "clicked", status_at: new Date().toISOString() })
            .eq("campaign_message_id", row.id).in("status", ["sent", "delivered", "opened"]),
          row.account_id
            ? db.rpc("crm_log_event", buildEvent({
                type: "cta_clicked", accountId: row.account_id as string, source: "customer",
                payload: { campaignKey: String((row.campaigns as { key?: string } | null)?.key ?? "campaign"), linkKey: parsed.url.slice(0, 60) },
                dedupeKey: dedupeKey("click", row.id as string, today, parsed.url.slice(0, 80)),
              }))
            : Promise.resolve(null),
        ]);
      }
    } catch (e) {
      reportError(e, { where: "campaigns.trackedLink", bestEffort: true });
    }
  }
  return NextResponse.redirect(parsed.url, 302);
}
