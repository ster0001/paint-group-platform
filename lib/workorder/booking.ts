/**
 * A job's booking, as the work order and the calendar both need to say it.
 *
 * REQUESTED and CONFIRMED are different facts and the screen must not blur
 * them: a date the office has asked for is not a date anybody has agreed to.
 * The distinction is derived from the live offer rather than stored, so the two
 * can never drift apart.
 */

export type BookingState = "none" | "requested" | "proposed" | "confirmed";

export type Booking = {
  state: BookingState;
  startDate: string | null;
  endDate: string | null;
};

const LABEL: Record<BookingState, string> = {
  none: "Not booked",
  requested: "Requested",
  proposed: "Contractor proposed a change",
  confirmed: "Confirmed",
};

/** Amber while it waits on a person, emerald once agreed — the loop's palette. */
const TONE: Record<BookingState, "muted" | "amber" | "emerald"> = {
  none: "muted", requested: "amber", proposed: "amber", confirmed: "emerald",
};

export const bookingLabel = (state: BookingState) => LABEL[state];
export const bookingTone = (state: BookingState) => TONE[state];

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

/**
 * "Mon 24 Aug – Wed 26 Aug", or a single day, or an honest nothing.
 * Never invents an end date: a booking with no end is one day, said as one day.
 */
export function bookingDates(booking: Booking): string {
  if (!booking.startDate) return "No dates yet";
  const start = day(booking.startDate);
  if (!booking.endDate || booking.endDate === booking.startDate) return start;
  return `${start} – ${day(booking.endDate)}`;
}

/** How many working days the booking spans, inclusive. */
export function bookingDays(booking: Booking): number {
  if (!booking.startDate) return 0;
  if (!booking.endDate) return 1;
  const from = Date.parse(`${booking.startDate}T00:00:00Z`);
  const to = Date.parse(`${booking.endDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 1;
  return Math.round((to - from) / 86_400_000) + 1;
}

/** What the work-order header says under the dates. */
export function bookingCaption(booking: Booking): string {
  switch (booking.state) {
    case "confirmed": return "Accepted by the contractor";
    case "requested": return "Sent to the contractor — waiting on their answer";
    case "proposed": return "They have asked to move it — needs your decision";
    case "none": return "Not on anyone's calendar yet";
  }
}
