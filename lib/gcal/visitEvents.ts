/**
 * Visit events in the estimator's MAIN Google calendar (visit booking
 * addendum A §4.6, S5). Pure builders and one pure classifier, unit-tested;
 * the reconcile (staff.ts) and the inbound sweep (inbound.ts) call them.
 *
 *   buildPrimaryVisitEvent — the ONE-HOUR visit (R32) with the property as the
 *                            location and the customer as a guest, so Google
 *                            emails the invitation; a popup reminder on the
 *                            estimator's copy (the API's `reminders` are "for
 *                            the authenticated user" — the customer's own
 *                            calendar reminds by its own settings).
 *   buildTravelEvent       — the 30-minute "Travel" block after it, no guests.
 *   classifyGoogleEvent    — what Google now says about our visit event: gone
 *                            (Tom deleted it — R27), declined (the guest said
 *                            no — R22), moved (R27: nothing changes, a card),
 *                            or same.
 */
import { GCAL_TIMEZONE, PG_EVENT_KIND, PG_VISIT_ID, type RawEvent } from "./client";
import type { VisitRow } from "@/lib/visits/types";

export type VisitForEvent = Pick<VisitRow, "id" | "starts_at" | "ends_at" | "address" | "suburb" | "customer_name" | "customer_phone" | "note" | "estimate_id" | "account_id">;

/** The estimator's popup, minutes before the visit. */
export const ESTIMATOR_REMINDER_MINUTES = 60;

/**
 * The title is what the CUSTOMER sees on the invitation and what the estimator
 * reads at a glance (Tom, 7 Oct: "Site visit: ENLVN PTY LTD" was the account's
 * business name — the title names US and the property; the customer is in the
 * description).
 */
export function buildPrimaryVisitEvent(v: VisitForEvent, customer: { email: string | null; name: string | null }, siteUrl: string | null, brand = "Paint Group"): Record<string, unknown> {
  const who = (v.customer_name || customer.name || "Customer").trim();
  const where = (v.address || v.suburb || "").trim();
  const lines = [`${brand} site visit — ${who}`];
  if (v.customer_phone) lines.push(`Phone: ${v.customer_phone}`);
  if (v.note) lines.push(v.note);
  if (v.estimate_id && siteUrl) lines.push(`${siteUrl}/quote?id=${v.estimate_id}`);
  if (v.account_id && siteUrl) lines.push(`${siteUrl}/crm/customers/${v.account_id}`);
  return {
    summary: `${brand} site visit${where ? ` — ${where}` : ""}`,
    location: v.address || undefined,
    description: lines.join("\n"),
    start: { dateTime: v.starts_at, timeZone: GCAL_TIMEZONE },
    end: { dateTime: v.ends_at, timeZone: GCAL_TIMEZONE },
    // The customer is a guest, so Google sends the invitation and records their reply.
    attendees: customer.email ? [{ email: customer.email, displayName: who }] : [],
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: ESTIMATOR_REMINDER_MINUTES }] },
    extendedProperties: { private: { [PG_EVENT_KIND]: "visit", [PG_VISIT_ID]: v.id } },
    transparency: "opaque",
  };
}

/** R32: the half hour after the visit, blocked in the estimator's calendar only. */
export function buildTravelEvent(v: Pick<VisitRow, "id" | "ends_at" | "suburb">, slotEndsAt: string): Record<string, unknown> {
  return {
    summary: `Travel${v.suburb ? ` from ${v.suburb}` : ""}`,
    start: { dateTime: v.ends_at, timeZone: GCAL_TIMEZONE },
    end: { dateTime: slotEndsAt, timeZone: GCAL_TIMEZONE },
    attendees: [],
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { [PG_EVENT_KIND]: "travel", [PG_VISIT_ID]: v.id } },
    transparency: "opaque",
  };
}

/** The instant the 90-minute run ends: the visit's start + slotMinutes. */
export function slotEndOf(startsAt: string, slotMinutes: number): string {
  return new Date(new Date(startsAt).getTime() + slotMinutes * 60_000).toISOString();
}

export type GoogleChange =
  | { kind: "gone" }
  | { kind: "declined" }
  | { kind: "moved"; googleStart: string }
  | { kind: "same"; googleStart: string };

/**
 * What Google says about our visit event now. `customerEmail` picks the guest
 * whose decline counts; a decline by anyone else (the estimator's own copy
 * says needsAction) is not a cancellation.
 */
export function classifyGoogleEvent(event: RawEvent | null, visitStartsAt: string, customerEmail: string | null): GoogleChange {
  if (!event || event.status === "cancelled") return { kind: "gone" };
  const guest = customerEmail
    ? event.attendees?.find((a) => (a.email ?? "").toLowerCase() === customerEmail.toLowerCase())
    : event.attendees?.find((a) => !a.self);
  if (guest?.responseStatus === "declined") return { kind: "declined" };
  const googleStart = event.start?.dateTime ? new Date(event.start.dateTime).toISOString() : event.start?.date ? `${event.start.date}T00:00:00.000Z` : visitStartsAt;
  if (Math.abs(new Date(googleStart).getTime() - new Date(visitStartsAt).getTime()) >= 60_000) return { kind: "moved", googleStart };
  return { kind: "same", googleStart };
}
