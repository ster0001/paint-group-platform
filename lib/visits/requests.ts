/**
 * Requests and messages (visit booking addendum A §4.4 / §4.5, S4). Server only.
 *
 *   createVisitRequest     — a time request (pre-arranged, none suit, nothing
 *                            free, unmapped), a visit asked for before the
 *                            range (R3), or a call from Speak with us (R25).
 *                            One `visit_requests` row, due by the end of the
 *                            next working day (R23/R33); the work queue
 *                            derives its card from the row.
 *   answerWithTime         — staff offer a time: books the slot for the
 *                            customer (any free slot, whatever its zone list),
 *                            sends the details and the invitation, no code.
 *   markAnswered           — staff answered another way (phoned, emailed).
 *   postCustomerMessage    — "Send us a message": into the EXISTING chat
 *                            (estimate chat after the range, website chat
 *                            before it) and emailed to the office with a copy
 *                            to the customer (R26, R35). Idempotent per client
 *                            id (section 8, test 17).
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { SupabaseAgentStore } from "@/lib/agent/store-supabase";
import { sendAutomation } from "@/lib/automations/dispatch";
import { logCrmEvent } from "@/lib/crm/events";
import { postCustomerChatMessage } from "@/lib/estimates/chat";
import { readGoogleBusyForStaff } from "@/lib/gcal/read";
import { reconcileForVisit } from "@/lib/gcal/staff";
import { normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { loadMessaging } from "@/lib/messaging/load";
import { buildPlainEmailHtml, sendEmail } from "@/lib/messaging/send";
import { emailLogoUrl } from "@/lib/messaging/logo";
import { reportError } from "@/lib/monitoring/report";
import { endOfNextWorkingDay } from "@/lib/time/workingDays";
import { loadAddress, markGateCompleted, maskMobile, saveVisitDetails, type EstimateCore, type VisitAddress } from "./holds";
import { sendVisitConfirmation, visitWhen } from "./notify";
import { availability, speakWithUsFor, type OfferedDay, type ScheduleBooking, type ScheduleBusy, type ScheduleHold } from "./schedule";
import { loadBookingRules, loadVisitScheduleData } from "./scheduleDb";
import { isZoneKey, normalisePostcode, resolveZone } from "./zones";

export type RequestKind = "time" | "visit" | "call";
export type TimeOfDay = "morning" | "afternoon" | "either";

export type RequestInput = {
  kind: RequestKind;
  /** The estimate (after the range) — or the draft id when asked before it. */
  est: EstimateCore | null;
  draftId: string | null;
  actorUserId: string;
  name: string; email: string; mobile: string;
  street?: string; suburb?: string; postcode?: string;
  note?: string;
  preferredDays?: number[];
  timeOfDay?: TimeOfDay;
};

export type RequestResult = { ok: true; requestId: string; dueAt: string } | { ok: false; status: number; code: string; message: string };

const first = (name: string) => name.trim().split(/\s+/)[0] || "there";

export async function createVisitRequest(svc: SupabaseClient, input: RequestInput, now = new Date()): Promise<RequestResult> {
  const mobile = normalisePhoneAU(input.mobile);
  if (!mobile) return { ok: false, status: 400, code: "invalid", message: "That mobile number doesn't look right." };
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  // The address: the estimate's (property or job address), else what the form gave.
  let address: VisitAddress | null = input.est ? await loadAddress(svc, input.est) : null;
  if (!address && (input.suburb || input.postcode || input.street)) {
    const street = (input.street ?? "").trim(), suburb = (input.suburb ?? "").trim(), postcode = normalisePostcode(input.postcode);
    address = { street, suburb, state: "VIC", postcode, formatted: [street, [suburb, "VIC", postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") };
  }
  const zone = address ? await resolveZone(svc, { suburb: address.suburb, postcode: address.postcode, state: address.state, estimateId: input.est?.id ?? null, draftId: input.draftId }) : null;

  // R25 / R34 / section 8 test 16: a call request only inside the phone range, decided here.
  if (input.kind === "call") {
    if (!input.est) return { ok: false, status: 409, code: "no_range", message: "Speak with us is offered once you have seen your guide price." };
    const bs = (input.est.builder_state && typeof input.est.builder_state === "object" ? input.est.builder_state : {}) as { guideRange?: { hiCents?: number; jobType?: string } | null };
    const rules = await loadBookingRules(svc);
    if (!speakWithUsFor(bs.guideRange?.jobType, bs.guideRange?.hiCents, rules)) {
      return { ok: false, status: 409, code: "outside_phone_range", message: "This job is outside the range we can finalise over the phone. Book a site visit or tighten your price online." };
    }
  }

  // The one identity model: the account (and property, when there is a street).
  const linked = await ensureAccountAndProperty(svc, {
    email, name, phone: mobile,
    address: address?.street ? { street: address.street, suburb: address.suburb, state: address.state, postcode: address.postcode } : undefined,
  });
  if (linked.accountId) {
    const { error } = await svc.from("accounts").update({ phone: mobile, name }).eq("id", linked.accountId);
    if (error) reportError(error, { where: "visits.requests.account", bestEffort: true });
    if (input.est && (!input.est.account_id || !input.est.property_id)) {
      const patch: Record<string, unknown> = { account_id: linked.accountId };
      if (linked.propertyId) patch.property_id = linked.propertyId;
      const { error: estErr } = await svc.from("estimates").update(patch).eq("id", input.est.id);
      if (estErr) reportError(estErr, { where: "visits.requests.estimateLink", bestEffort: true });
    }
    if (input.est) await markGateCompleted(svc, input.est.id);
  }

  const rules = await loadBookingRules(svc);
  const dueAt = endOfNextWorkingDay(now, new Set(rules.publicHolidays));
  const { data, error } = await svc.from("visit_requests").insert({
    kind: input.kind, estimate_id: input.est?.id ?? null, draft_id: input.draftId, account_id: linked.accountId ?? null, property_id: linked.propertyId ?? null,
    zone: zone?.outcome ?? "unmapped", suburb: address?.suburb ?? null, postcode: address?.postcode ?? null, address: address?.formatted ?? null,
    name, email, mobile, note: input.note?.trim() || null,
    preferred_days: (input.preferredDays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6), time_of_day: input.timeOfDay ?? null,
    created_by: input.actorUserId, due_at: dueAt.toISOString(),
  }).select("id").single();
  if (error) return { ok: false, status: 500, code: "failed", message: error.message };
  const requestId = data.id as string;

  // The wizard session: the outcome (buckets brief §3), with a note the work queue recognises
  // so the request's own card is the only one raised.
  const noteWords = input.kind === "call" ? "call" : input.kind === "visit" ? "site visit (before the range)" : "visit time";
  const draftFilter = input.draftId ? { col: "id", val: input.draftId } : input.est ? { col: "estimate_id", val: input.est.id } : null;
  if (draftFilter) {
    const { error: dErr } = await svc.from("wizard_drafts").update({
      outcome: input.kind === "call" ? "call_requested" : "visit_requested", outcome_at: now.toISOString(),
      outcome_note: `Requested online: ${noteWords} (request ${requestId})`, bucket: input.kind === "call" ? "ready_call" : "ready_visit",
      name, email, phone: mobile,
    }).eq(draftFilter.col, draftFilter.val);
    if (dErr) reportError(dErr, { where: "visits.requests.draft", bestEffort: true });
  }
  await logCrmEvent(svc, {
    type: "visit_request_made", source: "customer", accountId: linked.accountId ?? null, estimateId: input.est?.id ?? null,
    payload: { requestId, kind: input.kind, zone: zone?.outcome ?? "unmapped", note: input.note?.trim().slice(0, 600) || undefined }, dedupeKey: `visit_request:${requestId}`,
  });

  // The customer hears back straight away (section 10: "Request received" / "Call request received", email).
  try {
    const { messaging, company } = await loadMessaging(svc);
    const companyName = company.name || "Paint Group";
    const vars = { first_name: first(name), address: address?.formatted || "your property", mobile: maskMobile(mobile).replace(/•/g, "•"), company_name: companyName };
    const key = input.kind === "call" ? "call_request_received" : "request_received";
    const subject = renderTemplate(input.kind === "call" ? messaging.callRequestReceivedSubject : messaging.requestReceivedSubject, { ...vars, mobile: localMobile(mobile) });
    const body = renderTemplate(input.kind === "call" ? messaging.callRequestReceivedBody : messaging.requestReceivedBody, { ...vars, mobile: localMobile(mobile) });
    await sendAutomation(svc, {
      key, to: { email },
      email: { subject, replyTo: company.email || undefined, html: buildPlainEmailHtml({ heading: subject, message: body, companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }) },
      ctx: { accountId: linked.accountId ?? null, estimateId: input.est?.id ?? null, kind: key },
    });
  } catch (e) {
    reportError(e, { where: "visits.requests.receivedEmail", bestEffort: true, extra: { requestId } });
  }
  return { ok: true, requestId, dueAt: dueAt.toISOString() };
}

function localMobile(e164: string): string {
  if (/^\+61\d{9}$/.test(e164)) { const d = `0${e164.slice(3)}`; return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`; }
  return e164;
}

// ---- staff: the request and the slots they may offer -------------------------------

export type VisitRequestRow = {
  id: string; kind: RequestKind; estimate_id: string | null; account_id: string | null; property_id: string | null;
  zone: string; suburb: string | null; postcode: string | null; address: string | null;
  name: string; email: string | null; mobile: string | null; note: string | null;
  preferred_days: number[]; time_of_day: TimeOfDay | null;
  created_at: string; due_at: string; answered_at: string | null; answered_by: string | null; answer: string | null; visit_id: string | null;
};

export const REQUEST_SELECT = "id, kind, estimate_id, account_id, property_id, zone, suburb, postcode, address, name, email, mobile, note, preferred_days, time_of_day, created_at, due_at, answered_at, answered_by, answer, visit_id";

export async function loadRequest(db: SupabaseClient, id: string): Promise<VisitRequestRow | null> {
  const { data, error } = await db.from("visit_requests").select(REQUEST_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`visit_requests read failed: ${error.message}`);
  return (data as VisitRequestRow | null) ?? null;
}

export type StaffSlotDay = OfferedDay & { estimatorId: string; estimatorName: string };

/**
 * §4.4: "Staff may pick any free slot, including one whose zone list would not
 * normally allow that address." Every estimator with a week, zone "any", the
 * request's far-edge flag honoured, over the booking window.
 */
export async function staffOfferableSlots(svc: SupabaseClient, req: VisitRequestRow, now = new Date()): Promise<StaffSlotDay[]> {
  const { estimators, rules } = await loadVisitScheduleData(svc);
  const to = new Date(now.getTime() + (rules.windowDays + 2) * 86_400_000), from = new Date(now.getTime() - 86_400_000);
  const farEdge = req.suburb && req.postcode ? (await resolveZone(svc, { suburb: req.suburb, postcode: req.postcode }, { record: false })).farEdge : false;
  const out: StaffSlotDay[] = [];
  for (const e of estimators.filter((x) => x.slots.length)) {
    const [visits, holds] = await Promise.all([
      svc.from("visits").select("starts_at, zone, far_edge").eq("staff_id", e.id).eq("status", "booked").gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString()).limit(1000),
      svc.from("visit_holds").select("starts_at, expires_at").eq("estimator_id", e.id).is("released_at", null).is("confirmed_visit_id", null).gt("expires_at", now.toISOString()).limit(500),
    ]);
    if (visits.error) throw new Error(`visits read failed: ${visits.error.message}`);
    if (holds.error) throw new Error(`visit_holds read failed: ${holds.error.message}`);
    const bookings: ScheduleBooking[] = (visits.data ?? []).map((v) => ({ startsAt: v.starts_at as string, zone: isZoneKey(v.zone) ? v.zone : null, farEdge: v.far_edge === true }));
    const live: ScheduleHold[] = (holds.data ?? []).map((h) => ({ startsAt: h.starts_at as string, expiresAt: h.expires_at as string }));
    let busy: ScheduleBusy[] = [];
    try { const g = await readGoogleBusyForStaff([e.id], from, to); busy = g.busy.map((b) => ({ start: b.startsAt, end: b.endsAt })); } catch { /* unreachable calendar: nothing busy; S5 hardens this */ }
    const days = availability({ week: e.slots, bookings, holds: live, busy, rules, customer: { zone: "any", farEdge }, now });
    for (const d of days) out.push({ ...d, estimatorId: e.id, estimatorName: e.name });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.estimatorName.localeCompare(b.estimatorName));
}

export type AnswerResult = { ok: true; visitId: string } | { ok: false; message: string };

/** Staff offer a time: the slot is booked for the customer and they are told, no code (§4.4). */
export async function answerWithTime(svc: SupabaseClient, input: { requestId: string; estimatorId: string; startsAt: string; staffId: string }, now = new Date()): Promise<AnswerResult> {
  const req = await loadRequest(svc, input.requestId);
  if (!req) return { ok: false, message: "That request is gone." };
  if (req.answered_at) return { ok: false, message: "This request has already been answered." };
  const slots = await staffOfferableSlots(svc, req, now);
  const wanted = new Date(input.startsAt).getTime();
  const day = slots.find((d) => d.estimatorId === input.estimatorId && d.slots.some((s) => Math.abs(new Date(s.startsAt).getTime() - wanted) < 60_000));
  const slot = day?.slots.find((s) => Math.abs(new Date(s.startsAt).getTime() - wanted) < 60_000);
  if (!slot) return { ok: false, message: "That time is no longer free. Pick another." };
  const zone = req.suburb && req.postcode ? await resolveZone(svc, { suburb: req.suburb, postcode: req.postcode }, { record: false }) : null;

  // The visit, through the existing RPC (the office is the actor here), then its frozen zone.
  const { data: visitId, error } = await svc.rpc("visit_book", {
    p_starts: slot.startsAt, p_ends: slot.visitEndsAt, p_account: req.account_id, p_property: req.property_id, p_estimate: req.estimate_id,
    p_staff: input.estimatorId, p_kind: "quote", p_source: "staff", p_note: `Offered from request ${req.id}${req.note ? ` — ${req.note}` : ""}`,
  });
  if (error) return { ok: false, message: /double_booked|already taken/i.test(error.message) ? "That time has just been taken. Pick another." : error.message };
  const vid = visitId as string;
  const { error: upErr } = await svc.from("visits").update({
    zone: zone && isZoneKey(zone.outcome) ? zone.outcome : null, far_edge: zone?.farEdge ?? false,
    customer_name: req.name, customer_phone: req.mobile, address: req.address, suburb: req.suburb,
  }).eq("id", vid);
  if (upErr) reportError(upErr, { where: "visits.requests.visitZone", bestEffort: true });
  const { error: reqErr } = await svc.from("visit_requests").update({ answered_at: now.toISOString(), answered_by: input.staffId, visit_id: vid, answer: "Time offered" }).eq("id", req.id);
  if (reqErr) return { ok: false, message: reqErr.message };
  await logCrmEvent(svc, { type: "visit_request_answered", source: "staff", accountId: req.account_id, estimateId: req.estimate_id, payload: { requestId: req.id, kind: req.kind, visitId: vid, answer: "Time offered" }, dedupeKey: `visit_request_answered:${req.id}` });

  // Section 10 "Time offered by staff": text and email (with the invitation).
  try {
    const { messaging, company } = await loadMessaging(svc);
    const companyName = company.name || "Paint Group";
    const when = visitWhen(slot.startsAt, slot.visitEndsAt);
    const vars = { first_name: first(req.name), visit_when: when, address: req.address || "your property", estimator_name: day?.estimatorName || companyName, company_name: companyName };
    const subject = renderTemplate(messaging.timeOfferedSubject, vars);
    await sendAutomation(svc, {
      key: "time_offered",
      to: { phone: req.mobile, email: req.email },
      sms: { body: renderTemplate(messaging.timeOfferedSms, vars) },
      email: { subject, replyTo: company.email || undefined, html: buildPlainEmailHtml({ heading: subject, message: renderTemplate(messaging.timeOfferedBody, vars), companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }) },
      ctx: { accountId: req.account_id, estimateId: req.estimate_id, kind: "time_offered" },
    });
    await sendVisitConfirmation(svc, vid);
  } catch (e) {
    reportError(e, { where: "visits.requests.timeOffered", bestEffort: true, extra: { requestId: req.id } });
  }
  await reconcileForVisit([input.estimatorId]).catch((e) => reportError(e, { where: "visits.requests.gcal", bestEffort: true, extra: { visitId: vid } }));
  return { ok: true, visitId: vid };
}

export async function markAnswered(svc: SupabaseClient, input: { requestId: string; staffId: string; answer: string }, now = new Date()): Promise<{ ok: true } | { ok: false; message: string }> {
  const req = await loadRequest(svc, input.requestId);
  if (!req) return { ok: false, message: "That request is gone." };
  const { error } = await svc.from("visit_requests").update({ answered_at: now.toISOString(), answered_by: input.staffId, answer: input.answer.trim().slice(0, 600) || "Answered" }).eq("id", req.id).is("answered_at", null);
  if (error) return { ok: false, message: error.message };
  await logCrmEvent(svc, { type: "visit_request_answered", source: "staff", accountId: req.account_id, estimateId: req.estimate_id, payload: { requestId: req.id, kind: req.kind, answer: input.answer.trim().slice(0, 600) || undefined }, dedupeKey: `visit_request_answered:${req.id}` });
  return { ok: true };
}

// ---- messages ---------------------------------------------------------------------

export type MessageInput = {
  clientId: string;
  est: EstimateCore | null;
  draftId: string | null;
  actorUserId: string;
  body: string;
  /** Details, when the customer was asked for them first (R26). */
  contact?: { name: string; email: string; mobile: string; street?: string; suburb?: string; postcode?: string } | null;
};

export type MessageResult = { ok: true; where: "estimate_chat" | "website_chat"; repeated: boolean } | { ok: false; status: number; code: string; message: string };

export async function postCustomerMessage(svc: SupabaseClient, input: MessageInput, now = new Date()): Promise<MessageResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, status: 400, code: "empty", message: "Please write your message first." };

  // Section 8 test 17: the same client id twice is one message.
  const { data: seen, error: seenErr } = await svc.from("customer_message_receipts").select("client_id, estimate_id, conversation_id").eq("client_id", input.clientId).maybeSingle();
  if (seenErr) return { ok: false, status: 500, code: "failed", message: seenErr.message };
  if (seen) return { ok: true, where: seen.estimate_id ? "estimate_chat" : "website_chat", repeated: true };

  // Details first when we do not hold them (R26) — through the one identity model.
  let est = input.est;
  if (est && input.contact) {
    const saved = await saveVisitDetails(svc, est, input.contact);
    if (!saved.ok) return { ok: false, status: 400, code: "invalid", message: saved.message };
    const { data: fresh, error } = await svc.from("estimates").select("id, created_by, status, source, account_id, property_id, builder_state, title").eq("id", est.id).single();
    if (error) return { ok: false, status: 500, code: "failed", message: error.message };
    est = fresh as EstimateCore;
  }
  let accountId: string | null = est?.account_id ?? null;
  let customer = { name: input.contact?.name?.trim() ?? "", email: input.contact?.email?.trim().toLowerCase() ?? "" };
  if (!est && input.contact) {
    const mobile = normalisePhoneAU(input.contact.mobile);
    const linked = await ensureAccountAndProperty(svc, { email: customer.email, name: customer.name, phone: mobile, address: input.contact.street ? { street: input.contact.street, suburb: input.contact.suburb ?? "", state: "VIC", postcode: normalisePostcode(input.contact.postcode) } : undefined });
    accountId = linked.accountId ?? null;
    if (input.draftId) await svc.from("wizard_drafts").update({ name: customer.name, email: customer.email, phone: mobile, account_id: accountId }).eq("id", input.draftId);
  }
  if (accountId && !customer.email) {
    const { data: acc, error: accErr } = await svc.from("accounts").select("name, email").eq("id", accountId).maybeSingle();
    if (accErr) return { ok: false, status: 500, code: "failed", message: accErr.message };
    customer = { name: (acc?.name as string | null) ?? "", email: (acc?.email as string | null) ?? "" };
  }
  if (!customer.email) return { ok: false, status: 409, code: "no_contact", message: "We need your name, email and mobile first." };

  let where: "estimate_chat" | "website_chat";
  let conversationId: string | null = null;
  if (est) {
    // After the range: the estimate's own chat. A draft may have no share token yet.
    const { data: tok, error: tokErr } = await svc.from("estimates").select("share_token").eq("id", est.id).single();
    if (tokErr) return { ok: false, status: 500, code: "failed", message: tokErr.message };
    let token = tok.share_token as string | null;
    if (!token) {
      token = randomBytes(42).toString("base64url");
      const { error } = await svc.from("estimates").update({ share_token: token }).eq("id", est.id);
      if (error) return { ok: false, status: 500, code: "failed", message: error.message };
    }
    const posted = await postCustomerChatMessage(svc, { token, body }, now);
    if (posted.status !== "ok") return { ok: false, status: 500, code: "failed", message: "We couldn't post your message. Please try again." };
    where = "estimate_chat";
  } else {
    // Before the range: the website chat, handed to a person.
    const store = new SupabaseAgentStore(svc);
    const conv = await store.createConversation({ accountId, propertyId: null, estimateId: null, channel: "website", mode: "support", view: "customer", createdBy: input.actorUserId, anonToken: null, externalThreadId: null });
    await store.appendMessage({ conversationId: conv.id, role: "user", content: body, modelId: null, tokensIn: 0, tokensOut: 0 });
    await store.requestHandoff(conv.id, "customer_asked");
    conversationId = conv.id;
    where = "website_chat";
  }
  const { error: rcptErr } = await svc.from("customer_message_receipts").insert({ client_id: input.clientId, estimate_id: est?.id ?? null, conversation_id: conversationId, created_by: input.actorUserId });
  if (rcptErr && rcptErr.code !== "23505") reportError(rcptErr, { where: "visits.requests.receipt", bestEffort: true });
  await logCrmEvent(svc, { type: "customer_message_sent", source: "customer", accountId, estimateId: est?.id ?? null, payload: { clientId: input.clientId, where, note: body.slice(0, 600) }, dedupeKey: `customer_message:${input.clientId}` });

  // R35: emailed to the office address, with a copy to the customer. One email, both addresses.
  try {
    const { messaging, company } = await loadMessaging(svc);
    const office = (messaging.officeEmail || company.email || "").trim();
    if (!office) throw new Error("no office email in Settings");
    const companyName = company.name || "Paint Group";
    const job = est?.title || (await loadAddress(svc, est ?? ({ id: "", created_by: null, status: null, source: null, account_id: null, property_id: null, builder_state: null, title: null })).catch(() => null))?.formatted || "their estimate";
    const vars = { customer: customer.name || customer.email, job, message: body };
    const subject = renderTemplate(messaging.customerMessageSubject, vars);
    await sendEmail({
      to: [office, customer.email], subject, replyTo: customer.email,
      html: buildPlainEmailHtml({ heading: subject, message: renderTemplate(messaging.customerMessageBody, vars), companyName, logoUrl: emailLogoUrl(company), companyPhone: company.phone }),
      ctx: { accountId, estimateId: est?.id ?? null, kind: "customer_message" },
    });
  } catch (e) {
    reportError(e, { where: "visits.requests.messageEmail", bestEffort: true });
  }
  return { ok: true, where, repeated: false };
}
