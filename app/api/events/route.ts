import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { logCrmEvent } from "@/lib/crm/events";
import { allowPublicPlaces } from "@/lib/places/publicLimit";
import { MARKETING_EVENT_NAMES } from "@/lib/analytics";
import { VISITOR_ID_RE } from "@/lib/marketing/consent";

/**
 * POST /api/events — the first-party sink for the marketing site's events
 * (homepage brief §5). No session, no consent needed: the visitor is
 * anonymous, the payload is the event name + small props + the visitor
 * cookie, and the typed address is accepted for `see_price` ONLY — for any
 * other name it is dropped here even if a client sent it. Same-origin +
 * per-IP brake; zod first; written through crm_log_event with the service
 * client (the table has no client write path). Always answers 204: logging
 * must never break the page that is logging.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().max(40),
  props: z.record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).default({}),
  path: z.string().max(300).default("/"),
  visitorId: z.string().regex(VISITOR_ID_RE).nullable().default(null),
  address: z.string().trim().max(250).nullable().default(null),
});

export async function POST(request: Request) {
  if (!allowPublicPlaces(request, "events")) return new NextResponse(null, { status: 204 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 204 });
  const { name, props, path, visitorId, address } = parsed.data;
  if (!(MARKETING_EVENT_NAMES as readonly string[]).includes(name)) return new NextResponse(null, { status: 204 });

  const db = createServiceClient();
  if (db) {
    const { address: _dropped, ...safeProps } = props;
    void _dropped;
    await logCrmEvent(db, {
      type: "web_event",
      source: "customer",
      payload: { name, props: safeProps, path, visitorId, address: name === "see_price" ? address : null },
    });
  }
  return new NextResponse(null, { status: 204 });
}
