import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getWizardActor } from "@/lib/supabase/guards";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { sendMagicLink } from "@/lib/portal/auth";
import { reportError } from "@/lib/monitoring/report";
import { findOpenDraft, type OpenDraftRow } from "@/lib/wizard/draftOwner";
import { logCrmEvent } from "@/lib/crm/events";
import { settingValue } from "@/lib/wizard/policy";
import { bookWizardSlot, wizardVisitSlots } from "@/lib/visits/wizard";
import { isRepeat, outcomeNoteFor, phoneOrNull, resumeNext, saveAndBookSchema } from "@/lib/wizard/save-and-book";

/**
 * C8 — Save & book (addendum §4.17): ONE route for the pill on every screen,
 * the "Book someone in" card on screen 1 and "book an estimator for both".
 *
 * "We keep everything you've entered so far, and a person picks it up from
 * exactly here. Nothing to repeat." In order, because each is worth having
 * on its own and the later ones are best-effort:
 *
 *   1. the SESSION is the draft (C3: `wizard_drafts` IS the session). Its
 *      `last_screen` is the resume point — the client flushes the draft with
 *      the screen tag before calling here, so nothing is inferred. The
 *      outcome becomes `visit_requested`, which is what puts the lead on the
 *      work queue: the existing `wizard_ready` trigger in
 *      lib/crm/work-queue.ts, not a second list.
 *   2. the account and the property, so the lead survives the anonymous
 *      session (the same `ensureAccountAndProperty` the keep route uses)
 *   3. when the reveal has already made an estimate: the confirmation
 *      request (kind = visit), the slot booked on the existing scheduling
 *      system, and the two CRM events. Before the reveal there is no
 *      estimate to hang a request on, so the promise lives on the draft.
 *   4. the magic link, last and best-effort — an email outage must not cost
 *      somebody the session they asked us to keep.
 *
 * Idempotent on the session: the same tap twice is a repeat, not two jobs.
 * GET returns the offered visit windows for the sheet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function slotsFor(svc: NonNullable<ReturnType<typeof createServiceClient>>) {
  const { data: rows } = await svc.from("settings").select("key, value").eq("key", "scope_editor");
  const flags = (settingValue((rows ?? []) as Array<{ key: string; value: unknown }>, "scope_editor") ?? {}) as { visitSlots?: string[] };
  return wizardVisitSlots(svc, flags);
}

export async function GET() {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ slots: [] });
  const slots = await slotsFor(svc);
  return NextResponse.json({ slots: slots.labels.slice(0, 4) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Not signed in." }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = saveAndBookSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const name = input.name?.trim() || null;
  const phone = phoneOrNull(input.phone);
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "We can't save that just now." }, { status: 503 });

  // 1. The session. Found the way the wizard itself finds it (draftOwner),
  //    so the row we mark is the row the customer has been writing.
  const who = { userId: actor.user.id, verifiedEmail: actor.kind === "customer" ? actor.verifiedEmail : null };
  let found = actor.kind === "staff" ? null : await findOpenDraft(svc, who);
  if (!found && actor.kind !== "staff") {
    // The client flushed the draft as the sheet opened; a fast walk can post
    // before that insert lands. One short wait, then look again.
    await new Promise((r) => setTimeout(r, 1500));
    found = await findOpenDraft(svc, who);
  }
  let draft: OpenDraftRow | null = found?.row ?? null;
  if (!draft && actor.kind !== "staff" && input.snapshot) {
    // Still nothing: create the session from the sheet's snapshot rather than
    // lose the promise. The columns mirror the draft route's own insert.
    const st = input.snapshot.state as { jobType?: string; customer?: { suburb?: string; postcode?: string } | null };
    const now = new Date().toISOString();
    const { data: made, error } = await svc.from("wizard_drafts").insert({
      user_id: actor.user.id, state: input.snapshot.state,
      job_type: st.jobType ?? null, suburb: st.customer?.suburb ?? null, postcode: st.customer?.postcode ?? null,
      current_page: input.snapshot.page ?? 1, furthest_page: input.snapshot.page ?? 1, pages_total: input.snapshot.lastPage ?? 4,
      last_screen: input.screen, entry_source: "direct", started_at: now, last_seen_at: now, bucket: "online_now",
    }).select("id, user_id, account_id, email, state, job_type, address, suburb, current_page, furthest_page, pages_total, last_seen_at, converted_at, bucket").single();
    if (error) reportError(error, { where: "wizard.saveAndBook.createDraft", bestEffort: true });
    else draft = made as unknown as OpenDraftRow;
  }
  const draftFull = draft
    ? (await svc.from("wizard_drafts").select("id, email, outcome, outcome_note, state, address, suburb, postcode").eq("id", draft.id).maybeSingle()).data
    : null;
  if (draftFull && isRepeat(draftFull, input)) {
    return NextResponse.json({ ok: true, repeated: true, saved: true, booked: false, emailed: false });
  }

  // The estimate, if the reveal has made one — and only the caller's own.
  let estimate: { id: string; account_id: string | null; created_by: string | null } | null = null;
  if (input.estimateId) {
    const { data: est } = await svc.from("estimates").select("id, account_id, created_by").eq("id", input.estimateId).maybeSingle();
    if (!est) return NextResponse.json({ error: "No such estimate." }, { status: 404 });
    if (actor.kind === "customer" && est.created_by !== actor.user.id) {
      return NextResponse.json({ error: "That isn't your estimate." }, { status: 403 });
    }
    estimate = est;
  }

  // 2. The durable half — the account and the property.
  let accountId: string | null = estimate?.account_id ?? null;
  let propertyId: string | null = null;
  try {
    const st = (draftFull?.state ?? {}) as { address?: { address?: string; city?: string; state?: string; postal?: string } | null; customer?: { suburb?: string; postcode?: string } | null };
    const addr = st.address ?? null;
    const linked = await ensureAccountAndProperty(svc, {
      email, name, phone,
      address: addr?.address
        ? { street: addr.address, suburb: addr.city ?? "", state: addr.state ?? "", postcode: addr.postal ?? "" }
        : undefined,
    });
    accountId = linked.accountId ?? accountId;
    propertyId = linked.propertyId ?? null;
    if (estimate && linked.accountId) {
      await svc.from("estimates").update({ account_id: linked.accountId, property_id: linked.propertyId }).eq("id", estimate.id);
    }
  } catch (e) {
    reportError(e, { where: "wizard.saveAndBook.link", bestEffort: true });
  }

  // 1 (continued). Mark the session: who, the outcome, the resume point.
  const note = outcomeNoteFor(input.slot, input.screen);
  if (draft) {
    const { error } = await svc.from("wizard_drafts").update({
      email, ...(name ? { name } : {}), ...(phone ? { phone } : {}),
      ...(accountId ? { account_id: accountId } : {}),
      outcome: "visit_requested", outcome_at: new Date().toISOString(), bucket: "ready_visit",
      outcome_note: note, last_screen: input.screen,
      ...(estimate ? { estimate_id: estimate.id } : {}),
    }).eq("id", draft.id);
    if (error) reportError(error, { where: "wizard.saveAndBook.draft", bestEffort: true });
  }

  // 3. With an estimate: the promise as a row, the slot as a booking, and the events.
  let booked = false;
  let bookingProblem: string | null = null;
  if (estimate) {
    const { error: crError } = await svc.from("confirmation_requests").insert({
      estimate_id: estimate.id,
      requested_by: actor.kind === "staff" ? "staff" : "customer",
      kind: "visit", status: "requested", suggested_action: "visit", assigned_to: null, pack: {},
    });
    // 23505 = the one-open-request-per-estimate index: already promised, fine.
    if (crError && crError.code !== "23505") reportError(crError, { where: "wizard.saveAndBook.request", bestEffort: true });
    if (input.slot) {
      const slots = await slotsFor(svc);
      if (!slots.labels.includes(input.slot)) {
        bookingProblem = "That time has gone — pick another, or we'll call to arrange one.";
      } else {
        const r = await bookWizardSlot(svc, slots, input.slot, { accountId, estimateId: estimate.id, note: "Booked online — Save & book." });
        if (r && !r.ok) bookingProblem = r.message;
        else booked = r?.ok === true;
      }
    }
    await logCrmEvent(svc, {
      type: "confirmation_requested", accountId, estimateId: estimate.id,
      source: actor.kind === "staff" ? "staff" : "customer", payload: { kind: "visit", suggested: "visit", assigned: false },
    }).catch((e) => reportError(e, { where: "wizard.saveAndBook.event", bestEffort: true }));
    if (input.slot && booked) {
      await logCrmEvent(svc, {
        type: "visit_booked_from_wizard", accountId, estimateId: estimate.id,
        source: actor.kind === "staff" ? "staff" : "customer", payload: { when: input.slot.slice(0, 40) },
      }).catch((e) => reportError(e, { where: "wizard.saveAndBook.visitEvent", bestEffort: true }));
    }
  }

  // 4. The link, last. Best effort, said plainly.
  const sent = await sendMagicLink({
    email,
    next: resumeNext(estimate?.id),
    subject: estimate ? "Your painting estimate — saved" : "Your painting estimate — saved where you left it",
    intro:
      "Here's the link back to your estimate. It opens exactly where you left off — no password needed.\n\n" +
      (input.slot ? `We've got you down for ${input.slot}. ` : "One of us will be in touch to arrange a time. ") +
      "Nothing is booked in stone and nothing is owed.",
    buttonLabel: "Open my estimate",
  });

  return NextResponse.json({
    ok: true,
    repeated: false,
    saved: draft != null || estimate != null,
    accountLinked: accountId != null,
    propertyLinked: propertyId != null,
    booked,
    bookingProblem,
    emailed: sent.status === "sent",
    why: sent.status === "sent" ? null : sent.status,
  });
}
