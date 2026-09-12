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
import { phoneOrNull } from "@/lib/wizard/save-and-book";
import { briefBookSchema, briefEmailIntro, briefOutcomeNote, briefTitle } from "@/lib/wizard/brief-book";
import { briefConfigFor, checklistFromBrief, loadSegments } from "@/lib/wizard/segments";
import { holdDaysFromSettings } from "@/lib/wizard/confirmation-actions";

/**
 * C14 — BOOK A COMMERCIAL BRIEF (addendum S6c, §4.16, §4.17).
 *
 * The brief path NEVER prices: this route imports nothing from lib/pricing
 * and calls nothing that does. What it creates, in order:
 *
 *   1. the session (the draft), found the way the wizard finds it, or made
 *      from the snapshot if the flush has not landed (C8's rule);
 *   2. the ESTIMATE — a brief estimate: no priced blocks, total 0, the brief
 *      and the wizard state on its builder_state, so the estimates home,
 *      the Pack tab and the queue all see it;
 *   3. the `commercial_briefs` row, the `site_checklist_items` the config's
 *      map raises, and the photos claimed for the estimate;
 *   4. the account and the property, the `confirmation_requests` row (kind
 *      visit, the brief on its pack), the visit if a slot was chosen, the
 *      CRM events, the draft marked, the magic link.
 *
 * Atomic by ROLLBACK: the estimate is inserted first and deleted if any of
 * step 3 fails, which cascades the brief, the request and the checklist. A
 * visit that cannot be booked leaves the request standing with "we'll call
 * to arrange a time", exactly as Save & book does.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Svc = NonNullable<ReturnType<typeof createServiceClient>>;

async function slotsFor(svc: Svc) {
  const { data: rows } = await svc.from("settings").select("key, value").in("key", ["scope_editor", "wizard_hold_days"]);
  const settings = (rows ?? []) as Array<{ key: string; value: unknown }>;
  const flags = (settingValue(settings, "scope_editor") ?? {}) as { visitSlots?: string[] };
  return { slots: await wizardVisitSlots(svc, flags), settings };
}

export async function GET() {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Not signed in." }, { status: 403 });
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ slots: [], holdDays: 60 });
  const { slots, settings } = await slotsFor(svc);
  return NextResponse.json({ slots: slots.labels.slice(0, 4), holdDays: holdDaysFromSettings(settingValue(settings, "wizard_hold_days")) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const actor = await getWizardActor(supabase);
  if (actor.kind === "none") return NextResponse.json({ error: "Not signed in." }, { status: 403 });

  let raw: unknown;
  try { raw = await request.json(); } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = briefBookSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const name = input.name?.trim() || null;
  const phone = phoneOrNull(input.phone);
  const svc = createServiceClient();
  if (!svc) return NextResponse.json({ error: "We can't save that just now." }, { status: 503 });

  // The brief's questions are the row's — a key the table does not know is a 400.
  const segments = await loadSegments(svc);
  const cfg = briefConfigFor(segments, input.brief.briefKey);
  if (!cfg) return NextResponse.json({ error: "We don't recognise that kind of brief." }, { status: 400 });

  // 1. The session.
  const who = { userId: actor.user.id, verifiedEmail: actor.kind === "customer" ? actor.verifiedEmail : null };
  let found = actor.kind === "staff" ? null : await findOpenDraft(svc, who);
  if (!found && actor.kind !== "staff") {
    await new Promise((r) => setTimeout(r, 1500));
    found = await findOpenDraft(svc, who);
  }
  let draft: OpenDraftRow | null = found?.row ?? null;
  if (!draft && actor.kind !== "staff" && input.snapshot) {
    const st = input.snapshot.state as { jobType?: string; customer?: { suburb?: string; postcode?: string } | null };
    const now = new Date().toISOString();
    const { data: made, error } = await svc.from("wizard_drafts").insert({
      user_id: actor.user.id, state: input.snapshot.state,
      job_type: st.jobType ?? null, suburb: st.customer?.suburb ?? null, postcode: st.customer?.postcode ?? null,
      current_page: input.snapshot.page ?? 1, furthest_page: input.snapshot.page ?? 1, pages_total: input.snapshot.lastPage ?? 5,
      last_screen: input.screen, entry_source: "direct", started_at: now, last_seen_at: now, bucket: "online_now",
    }).select("id, user_id, account_id, email, state, job_type, address, suburb, current_page, furthest_page, pages_total, last_seen_at, converted_at, bucket").single();
    if (error) reportError(error, { where: "wizard.briefBook.createDraft", bestEffort: true });
    else draft = made as unknown as OpenDraftRow;
  }
  const state = ((draft?.state ?? input.snapshot?.state ?? {}) as Record<string, unknown>);
  const stateAddr = (state.address ?? null) as { street?: string; suburb?: string; state?: string; postcode?: string; formatted?: string } | null;
  const stateCustomer = (state.customer ?? null) as { suburb?: string; postcode?: string } | null;

  // 2. The estimate — no priced blocks, total 0, the brief on it.
  const title = briefTitle({ address: stateAddr, customer: stateCustomer }, cfg.row.name);
  const briefRecord = {
    segment: input.brief.segment, briefKey: input.brief.briefKey, what: input.brief.what, answers: input.brief.answers,
    notes: input.brief.notes, date: input.brief.date, photoSourceIds: input.sourceIds,
  };
  const { data: estRow, error: estError } = await svc.from("estimates").insert({
    title, status: "draft", source: "customer_intake", total_cents: 0,
    builder_state: {
      blocks: [], aiDeferred: [],
      brief: briefRecord,
      ...(stateAddr?.street ? { jobAddress: { address: stateAddr.street, city: stateAddr.suburb ?? "", state: stateAddr.state ?? "", postal: stateAddr.postcode ?? "" } } : {}),
      wizard: { version: 1, state, submittedAt: new Date().toISOString(), brief: true },
    },
    ...(actor.kind === "customer" ? { created_by: actor.user.id } : {}),
  }).select("id").single();
  if (estError || !estRow) {
    reportError(estError ?? new Error("no estimate row"), { where: "wizard.briefBook.estimate", bestEffort: true });
    return NextResponse.json({ error: "We couldn't save the brief — try again in a moment." }, { status: 500 });
  }
  const estimateId = estRow.id as string;

  // 3. The brief, the checklist, the photos — or roll the estimate back.
  const rollback = async (where: string, e: unknown) => {
    reportError(e, { where, bestEffort: true });
    await svc.from("estimates").delete().eq("id", estimateId).then(() => null, () => null);
    return NextResponse.json({ error: "We couldn't save the brief — try again in a moment." }, { status: 500 });
  };
  const briefIns = await svc.from("commercial_briefs").insert({
    estimate_id: estimateId, draft_id: draft?.id ?? null, created_by: actor.user.id,
    segment: input.brief.segment, brief_key: input.brief.briefKey, what: input.brief.what, answers: input.brief.answers,
    notes: input.brief.notes, meeting_date: input.brief.date, photo_source_ids: input.sourceIds,
  }).select("id").single();
  if (briefIns.error) return rollback("wizard.briefBook.brief", briefIns.error);
  const briefId = briefIns.data.id as string;
  const checklist = checklistFromBrief(cfg.brief, { briefKey: input.brief.briefKey, what: input.brief.what, answers: input.brief.answers, notes: input.brief.notes, date: input.brief.date });
  if (checklist.length) {
    const ck = await svc.from("site_checklist_items").insert(checklist.map((c) => ({ estimate_id: estimateId, key: c.key, value: c.value, source: "brief" })));
    if (ck.error) return rollback("wizard.briefBook.checklist", ck.error);
  }
  if (input.sourceIds.length) {
    const claim = await svc.from("estimate_sources").update({ estimate_id: estimateId }).in("id", input.sourceIds).is("estimate_id", null);
    if (claim.error) reportError(claim.error, { where: "wizard.briefBook.photos", bestEffort: true });
  }

  // 4. The account and the property.
  let accountId: string | null = null;
  let propertyId: string | null = null;
  try {
    const linked = await ensureAccountAndProperty(svc, {
      email, name, phone,
      address: stateAddr?.street
        ? { street: stateAddr.street, suburb: stateAddr.suburb ?? "", state: stateAddr.state ?? "", postcode: stateAddr.postcode ?? "" }
        : undefined,
    });
    accountId = linked.accountId ?? null;
    propertyId = linked.propertyId ?? null;
    if (accountId) await svc.from("estimates").update({ account_id: accountId, property_id: propertyId }).eq("id", estimateId);
  } catch (e) {
    reportError(e, { where: "wizard.briefBook.link", bestEffort: true });
  }

  // The session: who, the outcome, the resume point.
  const note = briefOutcomeNote(input.slot, input.brief.briefKey);
  if (draft) {
    const { error } = await svc.from("wizard_drafts").update({
      email, ...(name ? { name } : {}), ...(phone ? { phone } : {}),
      ...(accountId ? { account_id: accountId } : {}),
      outcome: "visit_requested", outcome_at: new Date().toISOString(), bucket: "ready_visit",
      outcome_note: note, last_screen: input.screen, estimate_id: estimateId,
    }).eq("id", draft.id);
    if (error) reportError(error, { where: "wizard.briefBook.draft", bestEffort: true });
  }

  // The promise as a row (the brief rides its pack), the slot as a visit, the events.
  const { error: crError } = await svc.from("confirmation_requests").insert({
    estimate_id: estimateId,
    requested_by: actor.kind === "staff" ? "staff" : "customer",
    kind: "visit", status: "requested", suggested_action: "visit", assigned_to: null,
    pack: { brief: { ...briefRecord, briefId, segmentName: cfg.row.name, checklist } },
  });
  if (crError) return rollback("wizard.briefBook.request", crError);
  let booked = false;
  let bookingProblem: string | null = null;
  if (input.slot) {
    const { slots } = await slotsFor(svc);
    if (!slots.labels.includes(input.slot)) {
      bookingProblem = "That time has gone — pick another, or we'll call to arrange one.";
    } else {
      const r = await bookWizardSlot(svc, slots, input.slot, { accountId, estimateId, note: `Booked online — commercial brief (${cfg.row.name}).` });
      if (r && !r.ok) bookingProblem = r.message;
      else booked = r?.ok === true;
    }
  }
  const source = actor.kind === "staff" ? "staff" : "customer";
  await logCrmEvent(svc, {
    type: "confirmation_requested", accountId, estimateId, source,
    payload: { kind: "visit", suggested: "visit", assigned: false, brief: input.brief.briefKey },
  }).catch((e) => reportError(e, { where: "wizard.briefBook.event", bestEffort: true }));
  if (input.slot && booked) {
    await logCrmEvent(svc, {
      type: "visit_booked_from_wizard", accountId, estimateId, source, payload: { when: input.slot.slice(0, 40), brief: input.brief.briefKey },
    }).catch((e) => reportError(e, { where: "wizard.briefBook.visitEvent", bestEffort: true }));
  }

  // The link, last. Best effort, said plainly.
  const sent = await sendMagicLink({
    email,
    next: "/portal",
    subject: `Your ${cfg.row.name.toLowerCase()} — brief received`,
    intro: briefEmailIntro(booked ? input.slot : undefined, cfg.row.name),
    buttonLabel: "Open my account",
  });

  return NextResponse.json({
    ok: true,
    estimateId,
    briefId,
    accountLinked: accountId != null,
    propertyLinked: propertyId != null,
    booked,
    bookingProblem,
    emailed: sent.status === "sent",
    why: sent.status === "sent" ? null : sent.status,
  });
}
