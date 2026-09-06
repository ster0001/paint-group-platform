import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { allowPublicPlaces } from "@/lib/places/publicLimit";
import { ensureAccount } from "@/lib/accounts/link";
import { logCrmEvent } from "@/lib/crm/events";
import { reportError } from "@/lib/monitoring/report";

/**
 * POST /api/wizard/callback — "call me" from the online-estimates HOLDING
 * page (Phase 0 of the 6 Sep estimator plan).
 *
 * While the public wizard is switched off, the homepage's "See my price"
 * still lands here — so the landing must be a lead, not a dead end. The
 * visitor has no session (the holding page never signs anyone in); the
 * route takes name, phone, email and the address they typed, files an
 * account by email and a `callback_requested` CRM event, and the existing
 * work queue turns that into a "requested a call" item on Today
 * (lib/crm/work-queue.ts buildCallbackItems). Nothing else is created.
 *
 * Brakes: same-origin + a small per-IP bucket (lib/places/publicLimit), and
 * every failure is a quiet 200 with ok:false — a form on the holding page
 * must never look broken to the one person who filled it in.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(200),
  address: z.string().trim().max(250).optional(),
});

export async function POST(request: Request) {
  const quietly = (why: string, status = 200) => NextResponse.json({ ok: false, why }, { status });
  if (!allowPublicPlaces(request, "callback")) return quietly("busy", 429);

  let raw: unknown;
  try { raw = await request.json(); } catch { return quietly("unreadable", 400); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false, why: "shape", error: "Name, a phone number and an email, please." }, { status: 400 });

  const db = createServiceClient();
  if (!db) return quietly("no service client");

  const { name, phone, email, address } = parsed.data;
  try {
    const { accountId } = await ensureAccount(db, { email, name, phone });
    if (!accountId) return quietly("no account");
    const note = [
      "Asked for a call from the online-estimates holding page",
      address ? `for ${address}` : null,
    ].filter(Boolean).join(" ");
    await logCrmEvent(db, {
      type: "callback_requested",
      source: "customer",
      accountId,
      payload: { phone, note },
      dedupeKey: `holding-callback:${accountId}:${new Date().toISOString().slice(0, 13)}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    reportError(e, { where: "wizard.holding.callback", bestEffort: true });
    return quietly("threw");
  }
}
