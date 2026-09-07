import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { allowPublicPlaces } from "@/lib/places/publicLimit";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { isTestEmail } from "@/lib/accounts/identity";
import { logCrmEvent } from "@/lib/crm/events";
import { bookWindow, loadStaffAvailability, offeredVisitWindows } from "@/lib/visits/book";
import { bucketFor } from "@/lib/wizard/journey";
import { reportError } from "@/lib/monitoring/report";

/**
 * Tom, 8 Sep 2026: "currently they have to answer all of the questions to be
 * able to finalise their booking — they should be able to click at the bottom
 * to book a site visit, call us or request a call back at any time."
 *
 *   GET  /api/wizard/reach?windows=1   → the visit windows on offer right now
 *   POST /api/wizard/reach             → { kind: "callback" | "visit", name, phone, email?, windowKey?, page?, pageLabel?, address? }
 *
 * Works from ANY page of the wizard, with whatever the person has typed so
 * far. The visitor has the wizard's anonymous session (page 1 signs them in)
 * so their open draft — if any — is found and linked to the account the
 * name/phone/email make; without a draft the request still files. Either
 * way the office sees it on Today: a call back = the draft's "needs help"
 * item (or a `callback_requested` event when there is no draft); a visit =
 * a real `visits` row in the Diary, the confirmation .ics to the customer,
 * and the draft marked "Booked: …" so no second "book visit" card is raised.
 *
 * Same brakes as the holding page: same-origin + a per-IP bucket, and a
 * failure is a quiet 200 with ok:false — the bar must never look broken.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum(["callback", "visit"]),
  name: z.string().trim().min(1, "Your name, please.").max(120),
  phone: z.string().trim().min(8, "A phone number we can reach you on.").max(30),
  email: z.string().trim().email().max(200).or(z.literal("")).optional(),
  windowKey: z.string().trim().max(40).optional(),
  page: z.number().int().min(1).max(12).optional(),
  pageLabel: z.string().trim().max(40).optional(),
  address: z.object({ street: z.string().max(120).default(""), suburb: z.string().max(80).default(""), postcode: z.string().max(10).default(""), state: z.string().max(10).default("VIC") }).optional(),
  note: z.string().trim().max(400).optional(),
});

export async function GET(request: Request) {
  if (!allowPublicPlaces(request, "callback")) return NextResponse.json({ windows: [] }, { status: 429 });
  const db = createServiceClient();
  if (!db) return NextResponse.json({ windows: [] });
  try {
    const { windows } = await offeredVisitWindows(db, new Date());
    return NextResponse.json({ windows: windows.slice(0, 12).map((w) => ({ key: w.key, label: w.label })) });
  } catch (e) {
    reportError(e, { where: "wizard.reach.windows", bestEffort: true });
    return NextResponse.json({ windows: [] });
  }
}

export async function POST(request: Request) {
  const quietly = (why: string, status = 200, error?: string) => NextResponse.json({ ok: false, why, ...(error ? { error } : {}) }, { status });
  if (!allowPublicPlaces(request, "callback")) return quietly("busy", 429, "Give it a moment and try again.");
  let raw: unknown;
  try { raw = await request.json(); } catch { return quietly("unreadable", 400); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return quietly("shape", 400, parsed.error.issues[0]?.message ?? "Name and a phone number, please.");
  const db = createServiceClient();
  if (!db) return quietly("no service client");

  const { kind, name, phone, windowKey, page, pageLabel, address, note } = parsed.data;
  const email = (parsed.data.email ?? "").toLowerCase();
  try {
    // The open draft for this visitor, if the wizard signed them in.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: draft } = user
      ? await db.from("wizard_drafts").select("id, account_id, estimate_id, email, phone, name, converted_at, address, suburb, postcode")
          .eq("user_id", user.id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null };

    const addr = address ?? (draft?.address ? { street: String(draft.address), suburb: String(draft.suburb ?? ""), postcode: String(draft.postcode ?? ""), state: "VIC" } : undefined);
    const { accountId, propertyId } = await ensureAccountAndProperty(db, {
      email: email && !isTestEmail(email) ? email : (draft?.email as string | null) ?? null,
      name, phone,
      address: addr && (addr.street || addr.suburb) ? { street: addr.street, suburb: addr.suburb, postcode: addr.postcode, state: addr.state } : undefined,
    });
    if (!accountId) return quietly("no account", 200, "A phone number or an email is needed to reach you.");

    const nowIso = new Date().toISOString();
    const where = pageLabel ? ` (on ${pageLabel})` : "";
    if (draft && !draft.converted_at) {
      await db.from("wizard_drafts").update({
        account_id: draft.account_id ?? accountId,
        ...(draft.name ? {} : { name }), ...(draft.phone ? {} : { phone }), ...(draft.email || !email ? {} : { email }),
        last_seen_at: nowIso, ...(page ? { current_page: page } : {}),
      }).eq("id", draft.id);
    }

    if (kind === "callback") {
      if (draft && !draft.converted_at) {
        // The draft's own "needs help" item carries it to Today — one card, not two.
        await db.from("wizard_drafts").update({
          outcome: "help_requested", outcome_at: nowIso, outcome_note: (note ? `${note} ` : "Asked us to call back") + where,
          bucket: bucketFor({ completed: false, outcome: "help_requested", lastActiveAt: nowIso, now: new Date() }),
        }).eq("id", draft.id);
        await logCrmEvent(db, {
          type: "wizard_help_requested", source: "customer", accountId, estimateId: (draft.estimate_id as string | null) ?? null,
          payload: { phone, note: note || "Asked us to call back", page: pageLabel || undefined },
          dedupeKey: `wizard-reach:${draft.id}:callback:${nowIso.slice(0, 16)}`,
        });
      } else {
        await logCrmEvent(db, {
          type: "callback_requested", source: "customer", accountId,
          payload: { phone, note: `Asked for a call from the online estimate${where}${note ? ` — ${note}` : ""}` },
          dedupeKey: `wizard-reach:${accountId}:callback:${nowIso.slice(0, 13)}`,
        });
      }
      return NextResponse.json({ ok: true, kind, message: "Thanks — one of us will call you shortly. Keep going if you like; your answers are saved." });
    }

    // A visit: a real window, booked now.
    if (!windowKey) return quietly("no window", 400, "Pick a time first.");
    const booked = await bookWindow(db, windowKey, {
      accountId, propertyId, estimateId: (draft?.estimate_id as string | null) ?? null, kind: "quote", source: "wizard",
      note: `Booked from the online estimate${where}${note ? ` — ${note}` : ""}`,
    });
    if (!booked.ok) return quietly("not booked", 200, booked.code === "double_booked" ? "That time has just gone — pick another." : booked.message);
    const { data: v } = await db.from("visits").select("starts_at, staff_id").eq("id", booked.visitId).maybeSingle();
    const who = v?.staff_id ? (await loadStaffAvailability(db)).find((s) => s.staffId === v.staff_id)?.name ?? null : null;
    const when = v?.starts_at ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(String(v.starts_at))) : "";
    if (draft && !draft.converted_at) {
      // "Booked: …" is what keeps Today from raising a second "book visit" card (work-queue).
      await db.from("wizard_drafts").update({
        outcome: "visit_requested", outcome_at: nowIso, outcome_note: `Booked: ${when}${who ? ` with ${who}` : ""}${where}`,
        bucket: bucketFor({ completed: false, outcome: "visit_requested", lastActiveAt: nowIso, now: new Date() }),
      }).eq("id", draft.id);
    }
    return NextResponse.json({ ok: true, kind, visitId: booked.visitId, message: `Booked — ${when}${who ? ` with ${who}` : ""}. ${email ? "A calendar invite is on its way." : "We'll text you to confirm."} Keep going if you like; your answers are saved.` });
  } catch (e) {
    reportError(e, { where: "wizard.reach", bestEffort: true });
    return quietly("threw", 200, "That didn't go through — try again, or call us.");
  }
}
