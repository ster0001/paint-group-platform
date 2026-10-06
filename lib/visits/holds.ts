/**
 * Visit booking — the customer's path from the range to a booked visit
 * (addendum A §4.3, S3). Server only; every decision — zone, slots, hold,
 * code, confirmation — is made here from stored facts. The browser sends an
 * estimate id, a start instant and a code, nothing else.
 *
 *   loadVisitContext  — the address → zone, the estimator who covers it, and
 *                       THE availability function's answer for this customer
 *   saveVisitDetails  — name, email, mobile (and the address) when we do not
 *                       hold them yet, through the one identity model
 *   placeHold         — ten-minute hold + a 6-digit code by text
 *   confirmHold       — re-run availability, then the one-transaction RPC
 *   resendCode        — a new code on the same hold (three per hold)
 *
 * Codes are hashed with a server salt; the limits (section 8, tests 10–11)
 * are per hold (5 wrong, 3 resends) and per mobile / per IP over ten minutes,
 * counted from `visit_code_sends` so they survive across instances.
 */
import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAccountAndProperty } from "@/lib/accounts/link";
import { readGoogleBusyForStaff } from "@/lib/gcal/read";
import { loadMessaging } from "@/lib/messaging/load";
import { normalisePhoneAU, renderTemplate } from "@/lib/messaging/config";
import { sendSms } from "@/lib/messaging/send";
import { sendAutomation } from "@/lib/automations/dispatch";
import { reportError } from "@/lib/monitoring/report";
import { logCrmEvent } from "@/lib/crm/events";
import { availability, timeWords, type BookingRules, type OfferedDay, type OfferedSlot, type ScheduleBooking, type ScheduleBusy, type ScheduleHold } from "./schedule";
import { loadBookingRules, loadWeek } from "./scheduleDb";
import { sendVisitConfirmation, visitWhen } from "./notify";
import { estimatorForZone, isZoneKey, normalisePostcode, resolveZone, type Resolution } from "./zones";

// ---- the estimate as this module sees it ------------------------------------------

export type EstimateCore = {
  id: string;
  created_by: string | null;
  status: string | null;
  source: string | null;
  account_id: string | null;
  property_id: string | null;
  builder_state: unknown;
  title: string | null;
};

export const ESTIMATE_CORE_SELECT = "id, created_by, status, source, account_id, property_id, builder_state, title";

export type VisitAddress = { street: string; suburb: string; state: string; postcode: string; formatted: string };
export type VisitContact = { name: string; email: string; mobile: string };

export type VisitContext = {
  estimateId: string;
  address: VisitAddress | null;
  /** Complete when we hold a name, an email and a sendable mobile. */
  contact: VisitContact | null;
  /** What we hold so far, for prefilling the details form. */
  known: Partial<VisitContact>;
  zone: Resolution;
  estimatorId: string | null;
  estimatorName: string | null;
  days: OfferedDay[];
  rules: Pick<BookingRules, "holdMinutes" | "visitMinutes" | "slotMinutes">;
  /** This estimate's live hold, if the customer comes back to the page. */
  hold: { id: string; startsAt: string; expiresAt: string; maskedMobile: string } | null;
};

/** The property address from the linked property, else the estimate's own job address. */
export async function loadAddress(svc: SupabaseClient, est: EstimateCore): Promise<VisitAddress | null> {
  if (est.property_id) {
    const { data, error } = await svc.from("properties").select("address, suburb, state, postcode").eq("id", est.property_id).maybeSingle();
    if (error) throw new Error(`properties read failed: ${error.message}`);
    if (data?.suburb) return shape({ street: data.address, suburb: data.suburb, state: data.state, postcode: data.postcode });
  }
  const bs = (est.builder_state && typeof est.builder_state === "object" ? est.builder_state : {}) as { jobAddress?: { address?: string; city?: string; state?: string; postal?: string } | null };
  const a = bs.jobAddress;
  if (a && (a.city || a.postal)) return shape({ street: a.address, suburb: a.city, state: a.state, postcode: a.postal });
  // Older estimates from a typed address (no Places pick) carry no jobAddress;
  // the wizard draft that made them has the typed suburb and postcode.
  const { data: d, error } = await svc.from("wizard_drafts").select("address, suburb, postcode").eq("estimate_id", est.id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`wizard_drafts read failed: ${error.message}`);
  if (d && (d.suburb || d.postcode)) return shape({ street: "", suburb: d.suburb as string | null, state: "VIC", postcode: d.postcode as string | null });
  return null;
}

function shape(a: { street?: string | null; suburb?: string | null; state?: string | null; postcode?: string | null }): VisitAddress {
  const street = (a.street ?? "").trim(), suburb = (a.suburb ?? "").trim(), state = (a.state ?? "VIC").trim() || "VIC", postcode = normalisePostcode(a.postcode);
  return { street, suburb, state, postcode, formatted: [street, [suburb, state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") };
}

async function loadContact(svc: SupabaseClient, est: EstimateCore): Promise<{ contact: VisitContact | null; known: Partial<VisitContact> }> {
  if (!est.account_id) return { contact: null, known: {} };
  const { data, error } = await svc.from("accounts").select("name, email, phone").eq("id", est.account_id).maybeSingle();
  if (error) throw new Error(`accounts read failed: ${error.message}`);
  const name = (data?.name as string | null)?.trim() ?? "", email = (data?.email as string | null)?.trim().toLowerCase() ?? "";
  const mobile = data?.phone ? normalisePhoneAU(String(data.phone)) : null;
  const known: Partial<VisitContact> = { ...(name ? { name } : {}), ...(email && email.includes("@") ? { email } : {}), ...(mobile ? { mobile } : {}) };
  const complete = !!(name && email.includes("@") && mobile);
  return { contact: complete ? { name, email, mobile: mobile! } : null, known };
}

// ---- availability for one customer ------------------------------------------------

async function loadInputs(svc: SupabaseClient, estimatorId: string, rules: BookingRules, now: Date, excludeEstimateId: string | null) {
  const to = new Date(now.getTime() + (rules.windowDays + 2) * 86_400_000);
  const from = new Date(now.getTime() - 86_400_000);
  const [week, visits, holds] = await Promise.all([
    loadWeek(svc, estimatorId),
    svc.from("visits").select("starts_at, zone, far_edge").eq("staff_id", estimatorId).eq("status", "booked")
      .gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString()).limit(1000),
    svc.from("visit_holds").select("estimate_id, starts_at, expires_at").eq("estimator_id", estimatorId)
      .is("released_at", null).is("confirmed_visit_id", null).gt("expires_at", now.toISOString()).limit(500),
  ]);
  if (visits.error) throw new Error(`visits read failed: ${visits.error.message}`);
  if (holds.error) throw new Error(`visit_holds read failed: ${holds.error.message}`);
  const bookings: ScheduleBooking[] = (visits.data ?? []).map((v) => ({ startsAt: v.starts_at as string, zone: isZoneKey(v.zone) ? v.zone : null, farEdge: v.far_edge === true }));
  const liveHolds: ScheduleHold[] = (holds.data ?? []).filter((h) => h.estimate_id !== excludeEstimateId).map((h) => ({ startsAt: h.starts_at as string, expiresAt: h.expires_at as string }));
  // The estimator's own Google calendar (4.6 read). Unreachable → nothing busy; S5 hardens this.
  let busy: ScheduleBusy[] = [];
  try {
    const g = await readGoogleBusyForStaff([estimatorId], from, to);
    busy = g.busy.map((b) => ({ start: b.startsAt, end: b.endsAt }));
  } catch (e) {
    reportError(e, { where: "visits.holds.googleBusy", bestEffort: true });
  }
  return { week, bookings, holds: liveHolds, busy };
}

export async function loadVisitContext(svc: SupabaseClient, est: EstimateCore, opts: { now?: Date; record?: boolean } = {}): Promise<VisitContext> {
  const now = opts.now ?? new Date();
  const [address, { contact, known }, rules] = await Promise.all([loadAddress(svc, est), loadContact(svc, est), loadBookingRules(svc)]);
  const zone = address
    ? await resolveZone(svc, { suburb: address.suburb, postcode: address.postcode, state: address.state, estimateId: est.id }, { record: opts.record ?? true })
    : { outcome: "unmapped" as const, farEdge: false, row: null, basis: "unmapped" as const };
  let estimatorId: string | null = null, estimatorName: string | null = null, days: OfferedDay[] = [];
  if (isZoneKey(zone.outcome)) {
    estimatorId = await estimatorForZone(svc, zone.outcome);
    if (estimatorId) {
      const [prof, inputs] = await Promise.all([
        svc.from("profiles").select("name").eq("id", estimatorId).maybeSingle(),
        loadInputs(svc, estimatorId, rules, now, est.id),
      ]);
      if (prof.error) throw new Error(`profiles read failed: ${prof.error.message}`);
      estimatorName = (prof.data?.name as string | null) ?? null;
      days = availability({ ...inputs, rules, customer: { zone: zone.outcome, farEdge: zone.farEdge }, now });
    }
  }
  const { data: h, error: holdErr } = await svc.from("visit_holds").select("id, starts_at, expires_at, mobile").eq("estimate_id", est.id)
    .is("released_at", null).is("confirmed_visit_id", null).gt("expires_at", now.toISOString()).maybeSingle();
  if (holdErr) throw new Error(`visit_holds read failed: ${holdErr.message}`);
  return {
    estimateId: est.id, address, contact, known, zone, estimatorId, estimatorName, days,
    rules: { holdMinutes: rules.holdMinutes, visitMinutes: rules.visitMinutes, slotMinutes: rules.slotMinutes },
    hold: h ? { id: h.id as string, startsAt: h.starts_at as string, expiresAt: h.expires_at as string, maskedMobile: maskMobile(h.mobile as string) } : null,
  };
}

/** "0412 ••• 678" — the mockup's mask, from an E.164 number. */
export function maskMobile(e164: string): string {
  const local = e164.startsWith("+61") ? `0${e164.slice(3)}` : e164.replace(/^\+/, "");
  const d = local.replace(/\D/g, "");
  return `${d.slice(0, 4)} ••• ${d.slice(-3)}`;
}

// ---- details -------------------------------------------------------------------

export type DetailsInput = { name: string; email: string; mobile: string; street?: string; suburb?: string; postcode?: string };

export async function saveVisitDetails(svc: SupabaseClient, est: EstimateCore, input: DetailsInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const mobile = normalisePhoneAU(input.mobile);
  if (!mobile) return { ok: false, message: "That mobile number doesn't look right." };
  const current = await loadAddress(svc, est);
  const street = (input.street ?? current?.street ?? "").trim();
  const suburb = (input.suburb ?? current?.suburb ?? "").trim();
  const postcode = normalisePostcode(input.postcode ?? current?.postcode ?? "");
  const linked = await ensureAccountAndProperty(svc, {
    email: input.email.trim().toLowerCase(), name: input.name.trim(), phone: mobile,
    address: street ? { street, suburb, state: current?.state ?? "VIC", postcode } : undefined,
  });
  if (!linked.accountId) return { ok: false, message: "We couldn't save those details." };
  // The account keeps the mobile the code goes to; the identity link only fills blanks.
  const { error: accErr } = await svc.from("accounts").update({ phone: mobile, name: input.name.trim() }).eq("id", linked.accountId);
  if (accErr) return { ok: false, message: accErr.message };
  const patch: Record<string, unknown> = { account_id: linked.accountId };
  if (linked.propertyId) patch.property_id = linked.propertyId;
  if (!current && street) {
    const bs = (est.builder_state && typeof est.builder_state === "object" ? est.builder_state : {}) as Record<string, unknown>;
    patch.builder_state = { ...bs, jobAddress: { address: street, city: suburb, state: "VIC", postal: postcode } };
  }
  const { error } = await svc.from("estimates").update(patch).eq("id", est.id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ---- codes and limits ------------------------------------------------------------

const SALT = () => process.env.VISIT_CODE_SALT ?? process.env.WIZARD_IP_SALT ?? "";
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashCode = (estimateId: string, mobile: string, code: string) => createHash("sha256").update(`${estimateId}:${mobile}:${code}:${SALT()}`).digest("hex");
export const hashIp = (ip: string | null) => (ip ? createHash("sha256").update(`${ip}:${SALT()}`).digest("hex") : null);

/** Section 8, test 11: codes to one mobile, and from one address, over ten minutes. */
const LIMIT_WINDOW_MS = 10 * 60_000;
export const MOBILE_CODE_LIMIT = 5;
export const IP_CODE_LIMIT = 15;

async function codeLimited(svc: SupabaseClient, mobile: string, ipHash: string | null): Promise<boolean> {
  const since = new Date(Date.now() - LIMIT_WINDOW_MS).toISOString();
  const [m, i] = await Promise.all([
    svc.from("visit_code_sends").select("id", { count: "exact", head: true }).eq("mobile", mobile).gte("sent_at", since),
    ipHash ? svc.from("visit_code_sends").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("sent_at", since) : Promise.resolve({ count: 0, error: null }),
  ]);
  if (m.error) throw new Error(`visit_code_sends read failed: ${m.error.message}`);
  if (i.error) throw new Error(`visit_code_sends read failed: ${i.error.message}`);
  return (m.count ?? 0) >= MOBILE_CODE_LIMIT || (i.count ?? 0) >= IP_CODE_LIMIT;
}

async function textCode(svc: SupabaseClient, est: EstimateCore, mobile: string, code: string): Promise<void> {
  const { messaging, company } = await loadMessaging(svc);
  const body = renderTemplate(messaging.visitCodeSms, { code, company_name: company.name || "Paint Group" });
  const r = await sendSms({ to: mobile, body, ctx: { estimateId: est.id, accountId: est.account_id, kind: "visit_code" } });
  if (r.status === "error") reportError(new Error(r.message ?? "visit code text failed"), { where: "visits.holds.textCode", extra: { estimateId: est.id } });
}

// ---- hold --------------------------------------------------------------------------

export type HoldOk = { ok: true; holdId: string; expiresAt: string; maskedMobile: string; slot: { startsAt: string; dayWords: string; timeWords: string; visitEndWords: string; address: string } };
export type HoldFail = { ok: false; status: number; code: "no_contact" | "not_bookable" | "not_offered" | "taken" | "limited" | "failed"; message: string };

export async function placeHold(svc: SupabaseClient, est: EstimateCore, input: { startsAt: string; userId: string | null; ip: string | null }, now = new Date()): Promise<HoldOk | HoldFail> {
  const ctx = await loadVisitContext(svc, est, { now, record: false });
  if (!ctx.contact) return { ok: false, status: 409, code: "no_contact", message: "We need your name, email and mobile first." };
  if (!isZoneKey(ctx.zone.outcome) || !ctx.estimatorId) return { ok: false, status: 409, code: "not_bookable", message: "This address can't book a time online." };
  const wanted = new Date(input.startsAt).getTime();
  const slot = ctx.days.flatMap((d) => d.slots).find((s) => Math.abs(new Date(s.startsAt).getTime() - wanted) < 60_000);
  if (!slot) return { ok: false, status: 409, code: "not_offered", message: "That time isn't available. Please pick another." };
  const ipHash = hashIp(input.ip);
  if (await codeLimited(svc, ctx.contact.mobile, ipHash)) return { ok: false, status: 429, code: "limited", message: "Too many codes have been sent to that number just now. Please try again in ten minutes." };
  const code = newCode();
  const rules = await loadBookingRules(svc);
  const { data, error } = await svc.rpc("visit_hold_place", {
    p_estimate: est.id, p_estimator: ctx.estimatorId, p_starts: slot.startsAt, p_slot_minutes: rules.slotMinutes, p_visit_minutes: rules.visitMinutes,
    p_zone: ctx.zone.outcome, p_far_edge: ctx.zone.farEdge, p_mobile: ctx.contact.mobile, p_code_hash: hashCode(est.id, ctx.contact.mobile, code),
    p_hold_minutes: rules.holdMinutes, p_ip_hash: ipHash, p_user: input.userId,
  });
  if (error) return { ok: false, status: 500, code: "failed", message: `We couldn't hold that time: ${error.message}` };
  const r = data as { status: string; id?: string; expires_at?: string };
  if (r.status !== "ok" || !r.id || !r.expires_at) return { ok: false, status: 409, code: "taken", message: "Someone else has just taken that time. Please pick another." };
  await textCode(svc, est, ctx.contact.mobile, code);
  await logCrmEvent(svc, { type: "visit_hold_placed", accountId: est.account_id, estimateId: est.id, source: "customer", payload: { holdId: r.id, startsAt: slot.startsAt, zone: ctx.zone.outcome }, dedupeKey: `visit_hold:${r.id}` });
  return { ok: true, holdId: r.id, expiresAt: r.expires_at, maskedMobile: maskMobile(ctx.contact.mobile), slot: summarise(slot, ctx.address?.formatted ?? "") };
}

function summarise(slot: OfferedSlot, address: string) {
  const endMinutes = (new Date(slot.visitEndsAt).getTime() - new Date(slot.startsAt).getTime()) / 60_000 + slot.startMinutes;
  return { startsAt: slot.startsAt, dayWords: slot.dayWords, timeWords: slot.timeWords, visitEndWords: timeWords(endMinutes), address };
}

// ---- resend -------------------------------------------------------------------------

export async function resendCode(svc: SupabaseClient, est: EstimateCore, input: { holdId: string; ip: string | null }): Promise<{ ok: true } | HoldFail> {
  const { data: h, error } = await svc.from("visit_holds").select("id, estimate_id, mobile").eq("id", input.holdId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "failed", message: error.message };
  if (!h || h.estimate_id !== est.id) return { ok: false, status: 404, code: "failed", message: "That hold has ended." };
  const ipHash = hashIp(input.ip);
  if (await codeLimited(svc, h.mobile as string, ipHash)) return { ok: false, status: 429, code: "limited", message: "Too many codes have been sent to that number just now. Please try again in ten minutes." };
  const code = newCode();
  const { data, error: rpcErr } = await svc.rpc("visit_hold_resend", { p_hold: h.id, p_code_hash: hashCode(est.id, h.mobile as string, code), p_ip_hash: ipHash });
  if (rpcErr) return { ok: false, status: 500, code: "failed", message: rpcErr.message };
  if (data === "limit") return { ok: false, status: 429, code: "limited", message: "That's the last new code for this time. Pick the time again to start over." };
  if (data !== "ok") return { ok: false, status: 410, code: "taken", message: "That hold has ended. Please pick a time again." };
  await textCode(svc, est, h.mobile as string, code);
  return { ok: true };
}

// ---- confirm ------------------------------------------------------------------------

export type ConfirmOk = { ok: true; visitId: string; slot: HoldOk["slot"] };
export type ConfirmFail = { ok: false; status: number; code: "wrong" | "ended" | "expired" | "unavailable" | "failed"; message: string; attemptsLeft?: number };

export async function confirmHold(svc: SupabaseClient, est: EstimateCore, input: { holdId: string; code: string }, now = new Date()): Promise<ConfirmOk | ConfirmFail> {
  const { data: h, error } = await svc.from("visit_holds").select("id, estimate_id, estimator_id, starts_at, mobile, expires_at, released_at, confirmed_visit_id").eq("id", input.holdId).maybeSingle();
  if (error) return { ok: false, status: 500, code: "failed", message: error.message };
  if (!h || h.estimate_id !== est.id) return { ok: false, status: 404, code: "ended", message: "That hold has ended. Please pick a time again." };
  const ctx = await loadVisitContext(svc, est, { now, record: false });
  if (!ctx.contact || !ctx.address) return { ok: false, status: 409, code: "failed", message: "We need your details first." };
  const codeHash = hashCode(est.id, h.mobile as string, input.code);

  // Re-run every rule in 4.2 with this customer's own hold set aside. Anything
  // that has changed since the hold — a confirmed far-edge neighbour, a new
  // calendar entry — refuses here, before the database is asked.
  const wanted = new Date(h.starts_at as string).getTime();
  const stillOffered = !h.released_at && !h.confirmed_visit_id && ctx.days.flatMap((d) => d.slots).some((s) => Math.abs(new Date(s.startsAt).getTime() - wanted) < 60_000);
  if (!stillOffered && !h.confirmed_visit_id) {
    // Still let a wrong code be a wrong code, and an expired hold say so.
    if (h.released_at || new Date(h.expires_at as string).getTime() < now.getTime()) {
      await svc.rpc("visit_hold_release", { p_hold: h.id, p_reason: "expired" });
      return { ok: false, status: 410, code: "expired", message: "That time was released while you were away. Please pick a time again." };
    }
    await svc.rpc("visit_hold_release", { p_hold: h.id, p_reason: "unavailable" });
    return { ok: false, status: 409, code: "unavailable", message: "That time is no longer available. Please pick another." };
  }

  const rules = await loadBookingRules(svc);
  const { data, error: rpcErr } = await svc.rpc("visit_hold_confirm", {
    p_hold: h.id, p_code_hash: codeHash, p_account: est.account_id, p_property: est.property_id, p_far_pairs: rules.farEdgePairs,
    p_customer_name: ctx.contact.name, p_customer_phone: ctx.contact.mobile, p_address: ctx.address.formatted, p_suburb: ctx.address.suburb,
  });
  if (rpcErr) return { ok: false, status: 500, code: "failed", message: rpcErr.message };
  const r = data as { status: string; visit_id?: string; attempts_left?: number };
  switch (r.status) {
    case "wrong": return { ok: false, status: 400, code: "wrong", message: `That code isn't right. ${r.attempts_left === 1 ? "One more try." : `${r.attempts_left} tries left.`}`, attemptsLeft: r.attempts_left };
    case "ended": return { ok: false, status: 410, code: "ended", message: "Too many wrong codes. Please pick a time again and we'll send a new one." };
    case "expired": return { ok: false, status: 410, code: "expired", message: "That time was released while you were away. Please pick a time again." };
    case "unavailable": return { ok: false, status: 409, code: "unavailable", message: "That time is no longer available. Please pick another." };
    case "already_booked": return { ok: false, status: 409, code: "unavailable", message: "This estimate already has a visit booked." };
    case "missing": return { ok: false, status: 404, code: "ended", message: "That hold has ended. Please pick a time again." };
    case "booked": break;
    default: return { ok: false, status: 500, code: "failed", message: "Something went wrong booking that time." };
  }
  const visitId = r.visit_id!;
  const slot = ctx.days.flatMap((d) => d.slots).find((s) => Math.abs(new Date(s.startsAt).getTime() - wanted) < 60_000);
  const summary = slot ? summarise(slot, ctx.address.formatted) : { startsAt: h.starts_at as string, dayWords: "", timeWords: "", visitEndWords: "", address: ctx.address.formatted };
  await notifyBooked(svc, est, visitId, ctx.contact, summary).catch((e) => reportError(e, { where: "visits.holds.notifyBooked", bestEffort: true, extra: { visitId } }));
  return { ok: true, visitId, slot: summary };
}

/** R20 / section 10: a text and an email (with the calendar invitation) on confirmation. */
async function notifyBooked(svc: SupabaseClient, est: EstimateCore, visitId: string, contact: VisitContact, slot: HoldOk["slot"]) {
  const { data: v, error } = await svc.from("visits").select("starts_at, ends_at").eq("id", visitId).maybeSingle();
  if (error) reportError(new Error(`visits read failed: ${error.message}`), { where: "visits.holds.notifyBooked", bestEffort: true });
  const when = v ? visitWhen(v.starts_at as string, v.ends_at as string) : `${slot.dayWords}, ${slot.timeWords} to ${slot.visitEndWords}`;
  const { messaging, company } = await loadMessaging(svc);
  const vars = { visit_when: when, address: slot.address, company_name: company.name || "Paint Group", first_name: contact.name.split(/\s+/)[0] || "there" };
  await sendAutomation(svc, {
    key: "visit_booked",
    to: { phone: contact.mobile },
    sms: { body: renderTemplate(messaging.visitBookedSms, vars) },
    ctx: { accountId: est.account_id, estimateId: est.id, kind: "visit_booked" },
  });
  await sendVisitConfirmation(svc, visitId);
}
